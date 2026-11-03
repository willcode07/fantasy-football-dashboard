'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const dns = require('dns');
const http = require('http');
const { execFileSync } = require('child_process');
const { once } = require('node:events');
const test = require('node:test');
const { A2AClient } = require('../../examples/a2a-client');
const { runDemo } = require('../../examples/mock-agents');
const { createDesk } = require('./desk');
const { createA2AServer, createAttemptLockout, createRateLimiter, defaultNotify } = require('./http');

const LEAGUE_CODE = 'test-league-code';
const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34', family: 4 }];

async function listen(server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

async function withServer(options, fn) {
    if (typeof options === 'function') {
        fn = options;
        options = {};
    }
    const leagueCode = Object.prototype.hasOwnProperty.call(options, 'leagueCode')
        ? options.leagueCode
        : LEAGUE_CODE;
    const desk = createDesk({
        notify: options.notify,
        leagueCode,
        persistPath: options.persistPath || null,
        rosters: options.rosters || {
            lg: {
                1: { teamName: 'Team 1', ownerId: 'user-1' },
                2: { teamName: 'Team 2', ownerId: 'user-2' },
                3: { teamName: 'Team 3', ownerId: 'user-3' }
            }
        },
        lookup: options.lookup || PUBLIC_LOOKUP,
        secretKey: options.secretKey || crypto.createHash('sha256').update('a2a-test-secret').digest(),
        webhookTransport: options.webhookTransport
    });
    const publicBase = options.publicBase || 'http://127.0.0.1:8787';
    const server = createA2AServer({
        desk,
        rateLimit: options.rateLimit,
        publicBase,
        corsOrigins: options.corsOrigins
    });
    const base = await listen(server);
    try {
        await fn({ base, desk, publicBase });
    } finally {
        await close(server);
    }
}

function team(number, extra = {}) {
    return {
        teamId: String(number),
        teamName: extra.teamName || `Team ${number}`,
        leagueId: extra.leagueId || 'lg',
        name: extra.name || `Team ${number} Agent`,
        ...extra.fields
    };
}

async function register(base, body, extra = {}) {
    return A2AClient.register({
        baseUrl: base,
        leagueCode: Object.prototype.hasOwnProperty.call(extra, 'leagueCode') ? extra.leagueCode : LEAGUE_CODE,
        token: extra.token,
        ...body
    });
}

function rawRequest(base, { path = '/health', headers = {}, method = 'GET', body } = {}) {
    const url = new URL(path, base);
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method,
            headers
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try {
                    json = JSON.parse(text);
                } catch (error) {
                    json = null;
                }
                resolve({ status: res.statusCode, headers: res.headers, body: text, json });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

test('agent card advertises the negotiation skills', async () => {
    await withServer(async ({ base }) => {
        const response = await fetch(`${base}/.well-known/agent-card.json`);
        assert.equal(response.status, 200);
        const card = await response.json();
        assert.equal(card.protocolVersion, '0.3.0');
        assert.deepEqual(card.skills.map((skill) => skill.id), [
            'negotiate-trade',
            'negotiate-waiver-priority',
            'negotiate-faab'
        ]);
        assert.equal(card.capabilities.streaming, false);
        const alias = await fetch(`${base}/.well-known/agent.json`);
        assert.equal(alias.status, 200);
    });
});

test('public agent list hides tokens and webhook secrets', async () => {
    await withServer(async ({ base }) => {
        const registered = await register(base, {
            ...team(1),
            webhookUrl: 'https://hooks.example.com/hook',
            webhookSecret: 'do-not-leak'
        });
        const listed = await fetch(`${base}/api/a2a/agents?leagueId=lg`).then((response) => response.json());
        const blob = JSON.stringify(listed);
        assert.equal(blob.includes(registered.agentToken), false);
        assert.equal(blob.includes(registered.ownerToken), false);
        assert.equal(blob.includes('do-not-leak'), false);
        assert.equal(blob.includes('agentTokenHash'), false);
        assert.equal(blob.includes('webhookUrl'), false);
        assert.equal(listed.agents[0].metadata.teamId, '1');
        assert.equal(listed.agents[0].capabilities.pushNotifications, true);
    });
});

test('example agents negotiate a trade and owners approve without execution', async () => {
    await withServer(async ({ base }) => {
        const result = await runDemo({
            baseUrl: base,
            leagueId: 'lg',
            leagueCode: LEAGUE_CODE
        });
        assert.equal(result.task.status.state, 'input-required');
        assert.equal(result.task.executed, false);
        assert.equal(result.task.kind, 'trade');
        assert.equal(result.agentApproval.status, 403);
        assert.equal(result.agentApproval.code, 'human_approval_required');
        assert.match(result.task.currentOffer.summary, /Ja'Marr Chase/);

        const ownerA = new A2AClient({ baseUrl: base, token: result.owners[0].ownerToken });
        const ownerB = new A2AClient({ baseUrl: base, token: result.owners[1].ownerToken });
        const first = await ownerA.decide(result.task.id, 'approve');
        assert.equal(first.task.status.state, 'input-required');
        assert.equal(first.task.executed, false);
        assert.equal(first.task.humanApproval['1'].state, 'approved');
        assert.equal(first.task.humanApproval['2'].state, 'pending');

        const second = await ownerB.decide(result.task.id, 'approve');
        assert.equal(second.task.status.state, 'completed');
        assert.equal(second.task.executed, false);
        assert.equal(second.task.execution.automatic, false);
        assert.match(second.task.execution.reason, /No roster move is sent to Sleeper/);
        assert.equal(second.task.history.some((message) => (
            message.role === 'user' && message.metadata.action === 'approve'
        )), true);
        assert.equal(second.task.allowedActions.length, 0);
    });
});

test('the agent who wrote the current offer cannot accept it', async () => {
    await withServer(async ({ base }) => {
        const a = await register(base, team(1));
        const b = await register(base, team(2));
        const created = await a.client.createTask({
            kind: 'trade',
            toTeamId: '2',
            terms: { send: ['Justin Jefferson'], receive: ["Ja'Marr Chase"] }
        });
        await assert.rejects(
            () => a.client.message(created.task.id, { action: 'accept' }),
            (error) => error.status === 409
        );
        const countered = await b.client.message(created.task.id, {
            action: 'counter',
            terms: { send: ["Ja'Marr Chase"], receive: ['Justin Jefferson', '2026 3rd'] }
        });
        assert.equal(countered.task.status.state, 'working');
        assert.equal(countered.task.currentOffer.revision, 2);
        await assert.rejects(
            () => b.client.message(created.task.id, { action: 'accept' }),
            (error) => error.status === 409
        );
    });
});

test('waiver priority and faab use the same human gate', async () => {
    await withServer(async ({ base }) => {
        const a = await register(base, team(1));
        const b = await register(base, team(2));
        const waiver = await a.client.createTask({
            kind: 'waiver_priority',
            toTeamId: '2',
            terms: { fromPriority: 7, toPriority: 2 },
            text: 'Swap 7 for 2?'
        });
        const accepted = await b.client.message(waiver.task.id, { action: 'accept' });
        assert.equal(accepted.task.status.state, 'input-required');
        assert.equal(accepted.task.executed, false);
        const approved = await a.owner.decide(waiver.task.id, 'approve');
        assert.equal(approved.task.humanApproval['1'].state, 'approved');
        assert.equal(approved.task.status.state, 'input-required');

        const faab = await b.client.createTask({
            kind: 'faab',
            toTeamId: '1',
            terms: { player: 'Tank Bigsby', amount: 12, dropClaim: true }
        });
        assert.equal(faab.task.status.state, 'submitted');
        assert.match(faab.task.currentOffer.summary, /\$12 FAAB for Tank Bigsby/);
        const vetoed = await a.owner.decide(faab.task.id, 'veto');
        assert.equal(vetoed.task.status.state, 'rejected');
        assert.equal(vetoed.task.executed, false);
    });
});

test('outsiders cannot read a negotiation and owners can rotate tokens', async () => {
    await withServer(async ({ base }) => {
        const a = await register(base, team(1));
        const b = await register(base, team(2));
        const c = await register(base, team(3));
        const created = await a.client.createTask({
            kind: 'trade',
            toTeamId: '2',
            terms: { send: ['Player A'], receive: ['Player B'] }
        });
        await assert.rejects(
            () => c.client.getTask(created.task.id),
            (error) => error.status === 403
        );
        const seen = await b.owner.getTask(created.task.id);
        assert.equal(seen.task.id, created.task.id);
        assert.equal(seen.task.history[0].parts[0].type, 'text');

        const rotated = await a.owner.send('POST', `/api/a2a/agents/${a.agent.metadata.agentId}/token`);
        await assert.rejects(() => a.client.me(), (error) => error.status === 401);
        const replacement = new A2AClient({ baseUrl: base, token: rotated.agentToken });
        assert.equal((await replacement.me()).teamId, '1');
        await a.owner.send('DELETE', `/api/a2a/agents/${a.agent.metadata.agentId}`);
        await assert.rejects(() => a.owner.me(), (error) => error.status === 401);
    });
});

test('registration requires the league code and blocks metadata webhooks', async () => {
    await withServer({ leagueCode: 'open-sesame' }, async ({ base }) => {
        await assert.rejects(
            () => A2AClient.register({ baseUrl: base, ...team(1) }),
            (error) => error.status === 401 && error.code === 'unauthorized'
        );
        const registered = await A2AClient.register({
            baseUrl: base,
            leagueCode: 'open-sesame',
            ...team(1)
        });
        assert.equal(typeof registered.agentToken, 'string');
        assert.equal(typeof registered.ownerToken, 'string');
        await assert.rejects(
            () => A2AClient.register({
                baseUrl: base,
                leagueCode: 'open-sesame',
                ...team(2),
                webhookUrl: 'http://169.254.169.254/latest/meta-data'
            }),
            (error) => error.status === 400
        );
    });
});

test('registration and authenticated calls are rate limited', async () => {
    await withServer({
        rateLimit: {
            register: { windowMs: 60 * 1000, max: 2 },
            authed: { windowMs: 60 * 1000, max: 3 }
        }
    }, async ({ base }) => {
        await register(base, team(1));
        const second = await register(base, team(2));
        await assert.rejects(
            () => register(base, team(3)),
            (error) => error.status === 429 && error.code === 'rate_limited'
        );
        await second.client.me();
        await second.client.me();
        await second.client.me();
        await assert.rejects(
            () => second.client.me(),
            (error) => error.status === 429
        );
    });
});

test('rejects query tokens, huge bodies, and an agent trading with itself', async () => {
    await withServer(async ({ base }) => {
        const query = await fetch(`${base}/health?token=secret`);
        assert.equal(query.status, 400);

        const huge = await fetch(`${base}/api/a2a/agents`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ padding: 'x'.repeat(40 * 1024) })
        });
        assert.equal(huge.status, 413);

        const text = await fetch(`${base}/api/a2a/agents`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: 'nope'
        });
        assert.equal(text.status, 415);

        const a = await register(base, team(1));
        await assert.rejects(
            () => a.client.createTask({
                kind: 'trade',
                toTeamId: '1',
                terms: { send: ['Player A'], receive: ['Player B'] }
            }),
            (error) => error.status === 400
        );
        await assert.rejects(
            () => a.client.createTask({
                kind: 'trade',
                toTeamId: '2',
                terms: { send: ['Player A'], receive: ['Player B'] }
            }),
            (error) => error.status === 404
        );
    });
});

test('delivery rechecks the webhook and will not call a local address', async () => {
    let called = false;
    let transported = 0;
    const previous = global.fetch;
    global.fetch = async () => {
        called = true;
        return new Response(null, { status: 204 });
    };
    const transport = async () => {
        transported += 1;
    };
    try {
        await assert.rejects(
            () => defaultNotify({
                webhookUrl: 'http://127.0.0.1/hook',
                lookup: PUBLIC_LOOKUP,
                transport
            }, { event: 'task.created' }),
            (error) => error.status === 400
        );
        await assert.rejects(
            () => defaultNotify({
                webhookUrl: 'https://hooks.example.com/hook',
                lookup: async () => [{ address: '192.168.0.8', family: 4 }],
                transport
            }, { event: 'task.created' }),
            (error) => error.status === 400
        );
        await assert.rejects(
            () => defaultNotify({
                webhookUrl: 'https://hooks.example.com/hook',
                lookup: async () => [{ address: '10.0.0.1', family: 4 }],
                transport
            }, { event: 'task.created' }),
            (error) => error.status === 400
        );
        assert.equal(called, false);
        assert.equal(transported, 0);
    } finally {
        global.fetch = previous;
    }
});

test('webhook delivery stays pinned to the address resolved before connect', async () => {
    let lookups = 0;
    const lookup = async () => {
        lookups += 1;
        if (lookups > 1) return [{ address: '10.0.0.1', family: 4 }];
        return [{ address: '93.184.216.34', family: 4 }];
    };
    let seen = null;
    await defaultNotify({
        webhookUrl: 'https://hooks.example.com/hook',
        webhookSecret: 'pin-secret',
        lookup,
        transport: async (options, body) => {
            const pinned = await new Promise((resolve, reject) => {
                options.lookup('rebind.example', {}, (error, address, family) => {
                    if (error) reject(error);
                    else resolve({ address, family });
                });
            });
            seen = {
                address: options.address,
                hostname: options.hostname,
                servername: options.servername,
                pinned,
                body
            };
        }
    }, { event: 'task.created' });
    assert.equal(lookups, 1);
    assert.equal(seen.address, '93.184.216.34');
    assert.equal(seen.hostname, 'hooks.example.com');
    assert.equal(seen.servername, 'hooks.example.com');
    assert.deepEqual(seen.pinned, { address: '93.184.216.34', family: 4 });
    assert.equal(seen.body.includes('task.created'), true);

    let literalLookups = 0;
    await defaultNotify({
        webhookUrl: 'https://93.184.216.34/hook',
        lookup: async () => {
            literalLookups += 1;
            return [{ address: '10.0.0.1', family: 4 }];
        },
        transport: async (options) => {
            assert.equal(options.address, '93.184.216.34');
            assert.equal(options.hostname, '93.184.216.34');
        }
    }, { event: 'task.created' });
    assert.equal(literalLookups, 0);
});

test('webhooks notify the other agent and do not carry tokens', async () => {
    const hits = [];
    await withServer({
        notify: defaultNotify,
        webhookTransport: async (options, body) => {
            hits.push({
                raw: body,
                signature: options.headers['x-a2a-signature'],
                address: options.address
            });
        }
    }, async ({ base }) => {
        const secret = 'hook-secret';
        await register(base, {
            ...team(2, { teamName: 'Waiver Wolf' }),
            webhookUrl: 'https://hooks.example.com/hook',
            webhookSecret: secret
        });
        const proposer = await register(base, team(1, { teamName: 'Gridiron AI' }));
        await proposer.client.createTask({
            kind: 'trade',
            toTeamId: '2',
            terms: { send: ['Justin Jefferson'], receive: ["Ja'Marr Chase"] }
        });
        assert.equal(hits.length, 1);
        const payload = JSON.parse(hits[0].raw);
        assert.equal(payload.event, 'task.created');
        assert.equal(hits[0].address, '93.184.216.34');
        assert.equal(hits[0].raw.includes(proposer.agentToken), false);
        assert.equal(hits[0].raw.includes(proposer.ownerToken), false);
        assert.equal(hits[0].raw.includes(secret), false);
        const expected = crypto.createHmac('sha256', secret).update(hits[0].raw).digest('hex');
        assert.equal(hits[0].signature, `sha256=${expected}`);
    });
});

test('registration fails closed, checks the roster, and will not hijack an owner', async () => {
    await withServer({ leagueCode: null }, async ({ base }) => {
        await assert.rejects(
            () => register(base, team(1), { leagueCode: 'guess' }),
            (error) => error.status === 401 && error.code === 'unauthorized'
        );
    });

    await withServer(async ({ base }) => {
        await assert.rejects(
            () => register(base, team(99)),
            (error) => error.status === 404
        );
        const first = await register(base, { ...team(1), teamName: 'Spoofed Name' });
        assert.equal(first.agent.metadata.teamName, 'Team 1');
        assert.equal(first.ownerToken.length > 16, true);

        await assert.rejects(
            () => register(base, { ...team(1), name: 'Hijack' }),
            (error) => error.status === 403 && error.code === 'forbidden'
        );
        assert.equal((await first.owner.me()).role, 'owner');
        assert.equal((await first.client.me()).role, 'agent');

        const other = await register(base, team(2));
        await assert.rejects(
            () => register(base, { ...team(1), name: 'Stolen' }, { token: other.ownerToken }),
            (error) => error.status === 403
        );
        await assert.rejects(
            () => register(base, { ...team(1), name: 'Stolen' }, { token: first.agentToken, leagueCode: null }),
            (error) => error.status === 403
        );

        const replaced = await register(base, {
            ...team(1),
            name: 'Replacement',
            teamName: 'Still Spoofed'
        }, { token: first.ownerToken, leagueCode: null });
        assert.equal(replaced.ownerToken, null);
        assert.equal(replaced.owner, null);
        assert.equal(replaced.agent.metadata.agentId, first.agent.metadata.agentId);
        assert.equal(replaced.agent.metadata.teamName, 'Team 1');
        await assert.rejects(() => first.client.me(), (error) => error.status === 401);
        assert.equal((await first.owner.me()).teamId, '1');
        assert.equal((await replaced.client.me()).agent.name, 'Replacement');
        await assert.rejects(
            () => register(base, { ...team(1), webhookUrl: 'http://127.0.0.1/hook' }, { token: first.ownerToken }),
            (error) => error.status === 400
        );
        assert.equal((await replaced.client.me()).agent.name, 'Replacement');
    });
});

test('authenticated rate limits follow the caller IP and buckets are pruned', async () => {
    await withServer({
        rateLimit: {
            authed: { windowMs: 60 * 1000, max: 100 },
            authedIp: { windowMs: 60 * 1000, max: 3 }
        }
    }, async ({ base }) => {
        for (let index = 0; index < 3; index += 1) {
            const response = await fetch(`${base}/api/a2a/me`, {
                headers: { authorization: `Bearer ${'a'.repeat(20)}${index}` }
            });
            assert.equal(response.status, 401);
        }
        const blocked = await fetch(`${base}/api/a2a/me`, {
            headers: { authorization: `Bearer ${'b'.repeat(24)}` }
        });
        assert.equal(blocked.status, 429);
        assert.equal((await blocked.json()).error.code, 'rate_limited');
    });

    let clock = 0;
    const limiter = createRateLimiter({
        windowMs: 1000,
        max: 2,
        maxKeys: 2,
        now: () => clock
    });
    assert.equal(limiter('one').ok, true);
    assert.equal(limiter('two').ok, true);
    assert.equal(limiter('three').ok, true);
    assert.equal(limiter.size(), 2);
    assert.equal(limiter('one').ok, true);
    clock = 5000;
    assert.equal(limiter('fresh').ok, true);
    assert.equal(limiter.size(), 1);
});

test('CORS is an allowlist and the agent card ignores the Host header', async () => {
    await withServer(async ({ base, publicBase }) => {
        const evil = await rawRequest(base, { headers: { origin: 'https://evil.example' } });
        assert.equal(evil.headers['access-control-allow-origin'], undefined);
        assert.equal(String(evil.headers.vary).toLowerCase().includes('origin'), true);

        const allowed = await rawRequest(base, { headers: { origin: 'http://127.0.0.1:3000' } });
        assert.equal(allowed.headers['access-control-allow-origin'], 'http://127.0.0.1:3000');

        const card = await rawRequest(base, {
            path: '/.well-known/agent-card.json',
            headers: { host: 'evil.example', origin: 'https://evil.example' }
        });
        assert.equal(card.status, 200);
        assert.equal(JSON.stringify(card.json).includes('evil.example'), false);
        assert.equal(card.json.url, `${publicBase}/api/a2a`);
    });
});

test('webhook secrets stay encrypted across a restart and still sign deliveries', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-http-'));
    const persistPath = path.join(dir, 'store.json');
    const secretKey = crypto.createHash('sha256').update('reload-key').digest();
    const hits = [];
    const webhookTransport = async (options, body) => {
        hits.push({ raw: body, signature: options.headers['x-a2a-signature'] });
    };
    await withServer({ persistPath, secretKey, notify: defaultNotify, webhookTransport }, async ({ base }) => {
        await register(base, {
            ...team(2),
            webhookUrl: 'https://hooks.example.com/hook',
            webhookSecret: 'hook-secret'
        });
    });
    const stored = fs.readFileSync(persistPath, 'utf8');
    assert.equal(stored.includes('hook-secret'), false);
    assert.match(stored, /webhookSecretEnc":"v1:/);

    await withServer({ persistPath, secretKey, notify: defaultNotify, webhookTransport }, async ({ base }) => {
        const proposer = await register(base, team(1));
        await proposer.client.createTask({
            kind: 'trade',
            toTeamId: '2',
            terms: { send: ['Justin Jefferson'], receive: ["Ja'Marr Chase"] }
        });
    });
    assert.equal(hits.length, 1);
    const expected = crypto.createHmac('sha256', 'hook-secret').update(hits[0].raw).digest('hex');
    assert.equal(hits[0].signature, `sha256=${expected}`);
});

test('failed league codes lock the caller IP until the lockout expires', async () => {
    let clock = 1_000_000;
    await withServer({
        rateLimit: {
            register: { windowMs: 10 * 60 * 1000, max: 30, now: () => clock },
            registerLockout: { maxFailures: 5, lockoutMs: 15 * 60 * 1000, now: () => clock }
        }
    }, async ({ base }) => {
        for (let index = 0; index < 4; index += 1) {
            await assert.rejects(
                () => register(base, team(1), { leagueCode: 'nope' }),
                (error) => error.status === 401
            );
        }
        const createdEarly = await register(base, team(3));
        assert.equal(createdEarly.agent.metadata.teamId, '3');
        await assert.rejects(
            () => register(base, team(3), { leagueCode: 'nope' }),
            (error) => error.status === 403 && error.code === 'forbidden'
        );
        for (let index = 0; index < 4; index += 1) {
            await assert.rejects(
                () => register(base, team(1), { leagueCode: 'nope' }),
                (error) => error.status === 401
            );
        }
        await assert.rejects(
            () => register(base, team(1), { leagueCode: 'nope' }),
            (error) => error.status === 429 && error.code === 'rate_limited'
        );
        await assert.rejects(
            () => register(base, team(1)),
            (error) => error.status === 429 && error.code === 'rate_limited'
        );
        clock += (15 * 60 * 1000) - 1;
        await assert.rejects(
            () => register(base, team(1)),
            (error) => error.status === 429 && error.code === 'rate_limited'
        );
        clock += 1;
        const created = await register(base, team(1));
        assert.equal(created.agent.metadata.teamId, '1');
        assert.equal(created.ownerToken.length > 16, true);
    });

    let tiny = 0;
    const lockout = createAttemptLockout({ maxFailures: 2, lockoutMs: 1000, now: () => tiny });
    assert.equal(lockout.recordFailure('ip').locked, false);
    assert.equal(lockout.recordFailure('ip').locked, true);
    assert.equal(lockout.check('ip').ok, false);
    lockout.recordSuccess('ip');
    assert.equal(lockout.check('ip').ok, true);
    assert.equal(lockout.size(), 0);
});

test('the first league-code registration owns the team and only that owner token can change it', async () => {
    await withServer(async ({ base }) => {
        const response = await fetch(`${base}/api/a2a/agents`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-league-code': LEAGUE_CODE
            },
            body: JSON.stringify({ ...team(1), sleeperOwnerId: 'user-9' })
        });
        assert.equal(response.status, 201);
        const first = await response.json();
        assert.equal(first.agentToken.length > 16, true);
        assert.equal(first.ownerToken.length > 16, true);
        assert.equal(first.agent.metadata.teamName, 'Team 1');
        assert.equal(JSON.stringify(first).includes('user-1'), false);
        assert.equal(JSON.stringify(first).includes('user-9'), false);

        await assert.rejects(
            () => register(base, { ...team(1), name: 'Takeover' }),
            (error) => error.status === 403 && error.code === 'forbidden'
        );
        const owner = new A2AClient({ baseUrl: base, token: first.ownerToken });
        const agent = new A2AClient({ baseUrl: base, token: first.agentToken });
        assert.equal((await owner.me()).role, 'owner');

        await owner.send('DELETE', `/api/a2a/agents/${first.agent.metadata.agentId}`);
        await assert.rejects(
            () => register(base, { ...team(1), name: 'After disconnect' }),
            (error) => error.status === 403 && error.code === 'forbidden'
        );
        const revived = await register(base, { ...team(1), name: 'Revived' }, {
            token: first.ownerToken,
            leagueCode: null
        });
        assert.equal(revived.ownerToken, null);
        assert.equal(revived.agent.metadata.agentId, first.agent.metadata.agentId);
        await assert.rejects(() => agent.me(), (error) => error.status === 401);
        assert.equal((await revived.client.me()).agent.name, 'Revived');
        assert.equal((await owner.me()).role, 'owner');

        const other = await register(base, team(2));
        await assert.rejects(
            () => other.owner.send('POST', `/api/a2a/agents/${first.agent.metadata.agentId}/owner-token`),
            (error) => error.status === 403
        );
        const rotated = await owner.send('POST', `/api/a2a/agents/${first.agent.metadata.agentId}/owner-token`);
        assert.equal(rotated.ownerToken.length > 16, true);
        assert.notEqual(rotated.ownerToken, first.ownerToken);
        await assert.rejects(() => owner.me(), (error) => error.status === 401);
        assert.equal((await revived.client.me()).role, 'agent');
        const nextOwner = new A2AClient({ baseUrl: base, token: rotated.ownerToken });
        assert.equal((await nextOwner.me()).role, 'owner');
        await assert.rejects(
            () => register(base, team(1), { leagueCode: LEAGUE_CODE }),
            (error) => error.status === 403
        );
    });
});

function ensureTestAddress(address) {
    const attempts = [
        ['ip', ['addr', 'add', `${address}/32`, 'dev', 'lo']],
        ['sudo', ['-n', 'ip', 'addr', 'add', `${address}/32`, 'dev', 'lo']]
    ];
    let lastError = null;
    for (let index = 0; index < attempts.length; index += 1) {
        const [command, args] = attempts[index];
        try {
            execFileSync(command, args, { stdio: 'pipe' });
            return;
        } catch (error) {
            const text = `${error.stderr || ''}${error.message || ''}`;
            if (text.includes('File exists')) return;
            lastError = error;
        }
    }
    const shown = execFileSync('ip', ['addr', 'show', 'dev', 'lo'], { encoding: 'utf8' });
    if (!shown.includes(`${address}/`)) {
        throw lastError || new Error(`Could not assign ${address}`);
    }
}

test('requestPinned connects to the address from the first lookup', async () => {
    const address = '192.0.2.1';
    ensureTestAddress(address);
    let received = null;
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            received = {
                host: req.headers.host,
                path: req.url,
                signature: req.headers['x-a2a-signature'],
                body: Buffer.concat(chunks).toString('utf8')
            };
            res.writeHead(204);
            res.end();
        });
    });
    server.listen(0, address);
    await once(server, 'listening');
    const { port } = server.address();
    const hostname = 'hooks.example.com';
    let injected = 0;
    const lookup = async () => {
        injected += 1;
        if (injected > 1) return [{ address: '10.66.66.66', family: 4 }];
        return [{ address, family: 4 }];
    };
    const originalLookup = dns.lookup;
    const originalPromisesLookup = dns.promises.lookup;
    let nodeLookups = 0;
    dns.lookup = function pinnedTestLookup(host, options, callback) {
        const cb = typeof options === 'function' ? options : callback;
        if (host === hostname) {
            nodeLookups += 1;
            cb(null, '10.66.66.66', 4);
            return undefined;
        }
        return originalLookup.call(dns, host, options, callback);
    };
    dns.promises.lookup = async function pinnedTestPromisesLookup(host, options) {
        if (host === hostname) {
            nodeLookups += 1;
            return { address: '10.66.66.66', family: 4 };
        }
        return originalPromisesLookup.call(dns.promises, host, options);
    };
    const secret = 'pin-secret';
    try {
        await defaultNotify({
            webhookUrl: `http://${hostname}:${port}/hook`,
            webhookSecret: secret,
            lookup
        }, { event: 'task.created' });
    } finally {
        dns.lookup = originalLookup;
        dns.promises.lookup = originalPromisesLookup;
        await close(server);
    }
    assert.equal(injected, 1);
    assert.equal(nodeLookups, 0);
    assert.equal(received.path, '/hook');
    assert.equal(received.host, `${hostname}:${port}`);
    assert.equal(received.body.includes('task.created'), true);
    const expected = crypto.createHmac('sha256', secret).update(received.body).digest('hex');
    assert.equal(received.signature, `sha256=${expected}`);
});
