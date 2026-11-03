'use strict';

const crypto = require('crypto');
const http = require('http');
const { DeskError, assertWebhookUrl } = require('./desk');

const MAX_BODY = 32 * 1024;
const DEFAULT_ORIGINS = ['http://127.0.0.1:3000', 'http://localhost:3000'];

function createRateLimiter({ windowMs, max, now = () => Date.now(), maxKeys = 5000 } = {}) {
    const buckets = new Map();

    function prune(current) {
        buckets.forEach((stamps, key) => {
            const recent = stamps.filter((stamp) => current - stamp < windowMs);
            if (recent.length === 0) buckets.delete(key);
            else if (recent.length !== stamps.length) buckets.set(key, recent);
        });
    }

    function remember(key, stamps) {
        buckets.delete(key);
        buckets.set(key, stamps);
        while (buckets.size > maxKeys) {
            const oldest = buckets.keys().next().value;
            buckets.delete(oldest);
        }
    }

    function hit(key) {
        const current = now();
        prune(current);
        const recent = (buckets.get(key) || []).slice();
        if (recent.length >= max) {
            const retryAfter = Math.max(1, Math.ceil((windowMs - (current - recent[0])) / 1000));
            return { ok: false, retryAfter, remaining: 0 };
        }
        recent.push(current);
        remember(key, recent);
        return { ok: true, remaining: max - recent.length };
    }

    hit.size = () => buckets.size;
    return hit;
}

function bearer(req) {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) return null;
    if (match[1].length > 200) return null;
    return match[1];
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                tooBig = true;
                return;
            }
            chunks.push(chunk);
        });
        req.on('error', reject);
        req.on('end', () => {
            if (tooBig) {
                const error = new Error('Request body is too large.');
                error.code = 'payload_too_large';
                reject(error);
                return;
            }
            if (size === 0) {
                resolve({});
                return;
            }
            const type = req.headers['content-type'] || '';
            if (!type.includes('application/json')) {
                const error = new Error('Content-Type must be application/json.');
                error.code = 'unsupported_media';
                reject(error);
                return;
            }
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    const error = new Error('Request body must be a JSON object.');
                    error.code = 'bad_json';
                    reject(error);
                    return;
                }
                resolve(parsed);
            } catch (error) {
                const wrapped = new Error('Request body must be JSON.');
                wrapped.code = 'bad_json';
                reject(wrapped);
            }
        });
    });
}

function createA2AServer({ desk, rateLimit, publicBase, corsOrigins } = {}) {
    if (!desk) throw new Error('createA2AServer requires a desk');
    const allowedOrigins = corsOrigins && corsOrigins.length ? corsOrigins : DEFAULT_ORIGINS;
    const baseUrl = publicBase || 'http://127.0.0.1:8787';
    const limits = {
        register: createRateLimiter(rateLimit?.register || { windowMs: 10 * 60 * 1000, max: 8 }),
        authed: createRateLimiter(rateLimit?.authed || { windowMs: 60 * 1000, max: 60 }),
        authedIp: createRateLimiter(rateLimit?.authedIp || { windowMs: 60 * 1000, max: 120 }),
        publicRead: createRateLimiter(rateLimit?.publicRead || { windowMs: 60 * 1000, max: 120 })
    };

    return http.createServer(async (req, res) => {
        try {
            await route(req, res);
        } catch (error) {
            if (res.writableEnded) return;
            if (error instanceof DeskError) {
                send(req, res, error.status, { error: { code: error.code, message: error.message } });
                return;
            }
            if (error.code === 'payload_too_large') {
                send(req, res, 413, { error: { code: 'payload_too_large', message: error.message } });
                return;
            }
            if (error.code === 'bad_json') {
                send(req, res, 400, { error: { code: 'validation', message: error.message } });
                return;
            }
            if (error.code === 'unsupported_media') {
                send(req, res, 415, { error: { code: 'unsupported_media', message: error.message } });
                return;
            }
            console.error('A2A request failed');
            send(req, res, 500, { error: { code: 'internal', message: 'Internal error.' } });
        }
    });

    function writeCors(req, res) {
        res.setHeader('vary', 'Origin');
        const origin = req.headers.origin;
        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('access-control-allow-origin', origin);
        }
        res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('access-control-allow-headers', 'authorization, content-type, x-league-code');
        res.setHeader('access-control-max-age', '600');
    }

    function send(req, res, status, body, extraHeaders = {}) {
        writeCors(req, res);
        const payload = JSON.stringify(body);
        res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            ...extraHeaders
        });
        res.end(payload);
    }

    function allow(req, res, limiter, key) {
        const result = limiter(key || 'anonymous');
        if (result.ok) return true;
        send(req, res, 429, {
            error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' }
        }, { 'retry-after': String(result.retryAfter) });
        return false;
    }

    function allowAuthed(req, res, ip, token) {
        if (!allow(req, res, limits.authedIp, ip)) return false;
        const tokenKey = token
            ? crypto.createHash('sha256').update(token).digest('hex')
            : `anon:${ip}`;
        return allow(req, res, limits.authed, tokenKey);
    }

    async function route(req, res) {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (req.method === 'OPTIONS') {
            writeCors(req, res);
            res.writeHead(204);
            res.end();
            return;
        }
        if (url.searchParams.has('token') || url.searchParams.has('access_token')) {
            send(req, res, 400, {
                error: { code: 'validation', message: 'Pass tokens in the Authorization header, not the query string.' }
            });
            return;
        }

        const token = bearer(req);
        const ip = req.socket.remoteAddress || 'unknown';
        const path = url.pathname;

        if (req.method === 'GET' && path === '/health') {
            if (!allow(req, res, limits.publicRead, ip)) return;
            send(req, res, 200, { ok: true, service: 'a2a' });
            return;
        }

        if (req.method === 'GET' && (path === '/.well-known/agent-card.json' || path === '/.well-known/agent.json')) {
            if (!allow(req, res, limits.publicRead, ip)) return;
            send(req, res, 200, desk.leagueCard(baseUrl));
            return;
        }

        if (req.method === 'POST' && path === '/api/a2a/agents') {
            if (!allow(req, res, limits.register, ip)) return;
            const body = await readBody(req);
            const created = await desk.registerAgent(body, {
                leagueCode: req.headers['x-league-code'],
                bearerToken: token,
                baseUrl
            });
            send(req, res, 201, created);
            return;
        }

        if (req.method === 'GET' && path === '/api/a2a/agents') {
            if (!allow(req, res, limits.publicRead, ip)) return;
            send(req, res, 200, desk.listAgents({ leagueId: url.searchParams.get('leagueId') || undefined, baseUrl }));
            return;
        }

        if (req.method === 'GET' && path === '/api/a2a/me') {
            if (!allowAuthed(req, res, ip, token)) return;
            send(req, res, 200, desk.me(token, baseUrl));
            return;
        }

        const agentTokenRoute = path.match(/^\/api\/a2a\/agents\/([A-Za-z0-9_-]+)\/token$/);
        if (agentTokenRoute) {
            if (!allowAuthed(req, res, ip, token)) return;
            if (req.method !== 'POST') {
                send(req, res, 405, { error: { code: 'method_not_allowed', message: 'Use POST to rotate a token.' } });
                return;
            }
            send(req, res, 200, desk.rotateAgentToken(agentTokenRoute[1], token));
            return;
        }

        const agentRoute = path.match(/^\/api\/a2a\/agents\/([A-Za-z0-9_-]+)$/);
        if (agentRoute) {
            if (req.method === 'GET') {
                if (!allow(req, res, limits.publicRead, ip)) return;
                send(req, res, 200, desk.getAgent(agentRoute[1], baseUrl));
                return;
            }
            if (req.method === 'DELETE') {
                if (!allowAuthed(req, res, ip, token)) return;
                send(req, res, 200, desk.revokeAgent(agentRoute[1], token));
                return;
            }
            send(req, res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
            return;
        }

        if (path === '/api/a2a/tasks' && req.method === 'GET') {
            if (!allowAuthed(req, res, ip, token)) return;
            send(req, res, 200, desk.listTasks(token));
            return;
        }

        if (path === '/api/a2a/tasks' && req.method === 'POST') {
            if (!allowAuthed(req, res, ip, token)) return;
            const body = await readBody(req);
            const created = await desk.createTask({
                token,
                kind: body.kind,
                toTeamId: body.toTeamId,
                terms: body.terms,
                text: body.text
            });
            send(req, res, 201, created);
            return;
        }

        const decisionRoute = path.match(/^\/api\/a2a\/tasks\/([A-Za-z0-9_-]+)\/decision$/);
        if (decisionRoute) {
            if (!allowAuthed(req, res, ip, token)) return;
            if (req.method !== 'POST') {
                send(req, res, 405, { error: { code: 'method_not_allowed', message: 'Use POST to approve or veto.' } });
                return;
            }
            const body = await readBody(req);
            send(req, res, 200, await desk.decide({ token, taskId: decisionRoute[1], decision: body.decision }));
            return;
        }

        const messageRoute = path.match(/^\/api\/a2a\/tasks\/([A-Za-z0-9_-]+)\/messages$/);
        if (messageRoute) {
            if (!allowAuthed(req, res, ip, token)) return;
            if (req.method !== 'POST') {
                send(req, res, 405, { error: { code: 'method_not_allowed', message: 'Use POST to send a message.' } });
                return;
            }
            const body = await readBody(req);
            send(req, res, 200, await desk.postMessage({
                token,
                taskId: messageRoute[1],
                action: body.action,
                terms: body.terms,
                text: body.text
            }));
            return;
        }

        const taskRoute = path.match(/^\/api\/a2a\/tasks\/([A-Za-z0-9_-]+)$/);
        if (taskRoute && req.method === 'GET') {
            if (!allowAuthed(req, res, ip, token)) return;
            send(req, res, 200, desk.getTask(taskRoute[1], token));
            return;
        }

        send(req, res, 404, { error: { code: 'not_found', message: 'Not found.' } });
    }
}

async function defaultNotify(target, event) {
    const url = await assertWebhookUrl(target && target.webhookUrl, target && target.lookup);
    if (!url) throw new Error('Webhook URL is missing.');
    const body = JSON.stringify(event);
    const headers = {
        'content-type': 'application/json',
        'user-agent': 'fantasy-a2a/0.1'
    };
    if (target.webhookSecret) {
        const digest = crypto.createHmac('sha256', target.webhookSecret).update(body).digest('hex');
        headers['x-a2a-signature'] = `sha256=${digest}`;
    }
    const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) {
        throw new Error(`Webhook responded ${response.status}`);
    }
}

module.exports = {
    createA2AServer,
    createRateLimiter,
    defaultNotify
};
