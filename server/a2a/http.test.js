'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const { once } = require('node:events');
const test = require('node:test');
const { A2AClient } = require('../../examples/a2a-client');
const { runDemo } = require('../../examples/mock-agents');
const { createDesk } = require('./desk');
const { createA2AServer, defaultNotify } = require('./http');

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
    const desk = createDesk({
        notify: options.notify,
        leagueCode: options.leagueCode || null,
        persistPath: options.persistPath || null
    });
    const server = createA2AServer({ desk, rateLimit: options.rateLimit });
    const base = await listen(server);
    try {
        await fn({ base, desk });
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
        const registered = await A2AClient.register({
            baseUrl: base,
            ...team(1),
            webhookUrl: 'http://127.0.0.1:9/hook',
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
        const result = await runDemo({ baseUrl: base, leagueId: 'lg' });
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
        const a = await A2AClient.register({ baseUrl: base, ...team(1) });
        const b = await A2AClient.register({ baseUrl: base, ...team(2) });
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
        const a = await A2AClient.register({ baseUrl: base, ...team(1) });
        const b = await A2AClient.register({ baseUrl: base, ...team(2) });
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
        const a = await A2AClient.register({ baseUrl: base, ...team(1) });
        const b = await A2AClient.register({ baseUrl: base, ...team(2) });
        const c = await A2AClient.register({ baseUrl: base, ...team(3) });
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
        await A2AClient.register({ baseUrl: base, ...team(1) });
        const second = await A2AClient.register({ baseUrl: base, ...team(2) });
        await assert.rejects(
            () => A2AClient.register({ baseUrl: base, ...team(3) }),
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

        const a = await A2AClient.register({ baseUrl: base, ...team(1) });
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

test('webhooks notify the other agent and do not carry tokens', async () => {
    const hits = [];
    const hook = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            hits.push({
                raw: Buffer.concat(chunks).toString('utf8'),
                signature: req.headers['x-a2a-signature']
            });
            res.writeHead(204);
            res.end();
        });
    });
    const hookBase = await listen(hook);
    try {
        await withServer({ notify: defaultNotify }, async ({ base }) => {
            const secret = 'hook-secret';
            await A2AClient.register({
                baseUrl: base,
                ...team(2, { teamName: 'Waiver Wolf' }),
                webhookUrl: `${hookBase}/hook`,
                webhookSecret: secret
            });
            const proposer = await A2AClient.register({
                baseUrl: base,
                ...team(1, { teamName: 'Gridiron AI' })
            });
            await proposer.client.createTask({
                kind: 'trade',
                toTeamId: '2',
                terms: { send: ['Justin Jefferson'], receive: ["Ja'Marr Chase"] }
            });
            assert.equal(hits.length, 1);
            const payload = JSON.parse(hits[0].raw);
            assert.equal(payload.event, 'task.created');
            assert.equal(hits[0].raw.includes(proposer.agentToken), false);
            assert.equal(hits[0].raw.includes(proposer.ownerToken), false);
            assert.equal(hits[0].raw.includes(secret), false);
            const expected = crypto.createHmac('sha256', secret).update(hits[0].raw).digest('hex');
            assert.equal(hits[0].signature, `sha256=${expected}`);
        });
    } finally {
        await close(hook);
    }
});
