'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { assertWebhookUrl, createDesk, validateTerms } = require('./desk');

const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34', family: 4 }];
const SECRET_KEY = Buffer.alloc(32, 7);

test('trade terms reject a player on both sides', () => {
    assert.throws(
        () => validateTerms('trade', { send: ['Justin Jefferson'], receive: ['justin jefferson'] }),
        (error) => error.code === 'validation'
    );
});

test('waiver terms must be different integer priorities', () => {
    assert.deepEqual(validateTerms('waiver_priority', { fromPriority: 7, toPriority: 2 }), {
        fromPriority: 7,
        toPriority: 2
    });
    assert.throws(
        () => validateTerms('waiver_priority', { fromPriority: 4, toPriority: 4 }),
        (error) => error.code === 'validation'
    );
});

test('faab amount is a whole number of dollars', () => {
    assert.deepEqual(validateTerms('faab', { player: 'Tank Bigsby', amount: 12, dropClaim: true }), {
        player: 'Tank Bigsby',
        amount: 12,
        dropClaim: true
    });
    assert.throws(
        () => validateTerms('faab', { player: 'Tank Bigsby', amount: 12.5 }),
        (error) => error.code === 'validation'
    );
});

test('persisted desk keeps owner access and does not store raw tokens', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-desk-'));
    const persistPath = path.join(dir, 'store.json');
    const created = await createDesk({
        persistPath,
        leagueCode: 'desk-code',
        secretKey: SECRET_KEY,
        rosters: { lg: { 9: { teamName: 'Saved Team', ownerId: 'user-9' } } },
        lookup: PUBLIC_LOOKUP
    }).registerAgent({
        teamId: '9',
        teamName: 'Spoofed',
        leagueId: 'lg',
        name: 'Saver',
        webhookUrl: 'https://hooks.example.com/hook',
        webhookSecret: 'plain-secret'
    }, { leagueCode: 'desk-code' });
    const reloaded = createDesk({
        persistPath,
        leagueCode: 'desk-code',
        secretKey: SECRET_KEY,
        rosters: { lg: { 9: { teamName: 'Saved Team', ownerId: 'user-9' } } }
    });
    const me = reloaded.me(created.ownerToken);
    assert.equal(me.teamName, 'Saved Team');
    assert.equal(me.role, 'owner');

    const raw = fs.readFileSync(persistPath, 'utf8');
    assert.equal(raw.includes(created.ownerToken), false);
    assert.equal(raw.includes(created.agentToken), false);
    assert.equal(raw.includes('plain-secret'), false);
    assert.match(raw, /webhookSecretEnc":"v1:/);
    assert.equal((fs.statSync(persistPath).mode & 0o777), 0o600);
    assert.equal(reloaded.me(created.agentToken).role, 'agent');
});

test('webhook URLs reject local, private, and metadata targets', async () => {
    const blocked = [
        'http://127.0.0.1/hook',
        'http://127.0.0.1:9/hook',
        'http://localhost/hook',
        'http://10.1.2.3/hook',
        'http://192.168.1.9/hook',
        'http://172.16.0.4/hook',
        'http://100.64.0.1/hook',
        'http://169.254.169.254/latest/meta-data',
        'http://[::1]/hook',
        'http://[fd00::1]/hook',
        'http://[fe80::1]/hook',
        'http://metadata.google.internal/computeMetadata/v1/',
        'http://printer.local/hook',
        'http://secrets.internal/hook',
        'http://user:pass@93.184.216.34/hook',
        'file:///etc/passwd',
        'http://2130706433/hook',
        'http://0x7f000001/hook',
        'http://0177.0.0.1/hook'
    ];
    for (const url of blocked) {
        await assert.rejects(
            () => assertWebhookUrl(url, PUBLIC_LOOKUP),
            (error) => error.status === 400,
            url
        );
    }
    await assert.rejects(
        () => assertWebhookUrl('https://hooks.example.com/hook', async () => [
            { address: '93.184.216.34', family: 4 },
            { address: '10.0.0.1', family: 4 }
        ]),
        (error) => error.status === 400
    );
    await assert.rejects(
        () => assertWebhookUrl('https://hooks.example.com/hook', async () => {
            throw new Error('servfail');
        }),
        (error) => error.code === 'validation'
    );
    const allowed = await assertWebhookUrl('https://93.184.216.34/hook');
    assert.match(allowed, /^https:\/\/93\.184\.216\.34\/hook/);
    const named = await assertWebhookUrl('https://hooks.example.com/hook', PUBLIC_LOOKUP);
    assert.match(named, /^https:\/\/hooks\.example\.com\/hook/);
});

test('registration is closed without a league code and ignores a spoofed team name', async () => {
    const desk = createDesk({
        leagueCode: null,
        rosters: { lg: { 1: { teamName: 'Real Owners', ownerId: 'user-1' } } },
        lookup: PUBLIC_LOOKUP
    });
    await assert.rejects(
        () => desk.registerAgent({
            teamId: '1',
            teamName: 'Attacker',
            leagueId: 'lg',
            name: 'Attacker Agent'
        }, { leagueCode: 'anything' }),
        (error) => error.status === 401
    );
});

test('an existing agent is not replaced without that owner token', async () => {
    const desk = createDesk({
        leagueCode: 'desk-code',
        secretKey: SECRET_KEY,
        rosters: {
            lg: {
                1: { teamName: 'Real Owners', ownerId: 'user-1' },
                2: { teamName: 'Other Team', ownerId: 'user-2' }
            }
        },
        lookup: PUBLIC_LOOKUP
    });
    const first = await desk.registerAgent({
        teamId: '1',
        teamName: 'Attacker',
        leagueId: 'lg',
        name: 'Original'
    }, { leagueCode: 'desk-code' });
    assert.equal(first.agent.metadata.teamName, 'Real Owners');

    await assert.rejects(
        () => desk.registerAgent({
            teamId: '9',
            teamName: 'Missing',
            leagueId: 'lg',
            name: 'Nobody'
        }, { leagueCode: 'desk-code' }),
        (error) => error.status === 404
    );
    await assert.rejects(
        () => desk.registerAgent({
            teamId: '1',
            teamName: 'Hijack',
            leagueId: 'lg',
            name: 'Hijack'
        }, { leagueCode: 'desk-code' }),
        (error) => error.status === 403
    );
    assert.equal(desk.me(first.ownerToken).role, 'owner');
    assert.equal(desk.me(first.agentToken).role, 'agent');

    const other = await desk.registerAgent({
        teamId: '2',
        teamName: 'Other',
        leagueId: 'lg',
        name: 'Other Agent'
    }, { leagueCode: 'desk-code' });
    await assert.rejects(
        () => desk.registerAgent({
            teamId: '1',
            teamName: 'Hijack',
            leagueId: 'lg',
            name: 'Hijack'
        }, { bearerToken: other.ownerToken }),
        (error) => error.status === 403
    );
    assert.equal(desk.authenticate(first.agentToken).agent.name, 'Original');

    const replaced = await desk.registerAgent({
        teamId: '1',
        teamName: 'Still Spoofed',
        leagueId: 'lg',
        name: 'Replacement'
    }, { bearerToken: first.ownerToken });
    assert.equal(replaced.ownerToken, null);
    assert.equal(replaced.agent.metadata.agentId, first.agent.metadata.agentId);
    assert.equal(replaced.agent.metadata.teamName, 'Real Owners');
    assert.equal(desk.authenticate(first.agentToken), null);
    assert.equal(desk.me(first.ownerToken).role, 'owner');
    assert.equal(desk.me(replaced.agentToken).agent.name, 'Replacement');
});

test('sleeper roster lookup fails closed unless the team exists', async () => {
    const previous = global.fetch;
    global.fetch = async (url) => {
        const target = String(url);
        if (target.endsWith('/rosters')) {
            return new Response(JSON.stringify([{ roster_id: 4, owner_id: 'u1' }]), { status: 200 });
        }
        if (target.endsWith('/users')) {
            return new Response(JSON.stringify([{ user_id: 'u1', display_name: 'Bench Mob' }]), { status: 200 });
        }
        return new Response('no', { status: 500 });
    };
    try {
        const desk = createDesk({
            leagueCode: 'desk-code',
            secretKey: SECRET_KEY,
            lookup: PUBLIC_LOOKUP
        });
        const created = await desk.registerAgent({
            teamId: '4',
            teamName: 'Spoof',
            leagueId: 'league-verified',
            name: 'Bench'
        }, { leagueCode: 'desk-code' });
        assert.equal(created.agent.metadata.teamName, 'Bench Mob');
        global.fetch = async () => new Response('down', { status: 503 });
        await assert.rejects(
            () => desk.registerAgent({
                teamId: '1',
                teamName: 'X',
                leagueId: 'league-offline',
                name: 'X'
            }, { leagueCode: 'desk-code' }),
            (error) => error.status === 404 && error.code === 'not_found'
        );
    } finally {
        global.fetch = previous;
    }
});

test('plaintext webhook secrets are encrypted when a store is reloaded', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-migrate-'));
    const persistPath = path.join(dir, 'store.json');
    fs.writeFileSync(persistPath, JSON.stringify({
        agents: {
            agent_old: {
                id: 'agent_old',
                teamId: '1',
                teamName: 'Saved Team',
                leagueId: 'lg',
                name: 'Saver',
                description: 'Saved',
                webhookUrl: 'https://hooks.example.com/hook',
                webhookSecret: 'legacy-secret',
                agentTokenHash: 'abc',
                ownerTokenHash: 'def',
                createdAt: '2026-01-01T00:00:00.000Z',
                revokedAt: null
            }
        },
        tasks: {}
    }));
    createDesk({ persistPath, secretKey: SECRET_KEY, leagueCode: 'desk-code' });
    const raw = fs.readFileSync(persistPath, 'utf8');
    assert.equal(raw.includes('legacy-secret'), false);
    assert.equal(raw.includes('webhookSecret"'), false);
    assert.match(raw, /webhookSecretEnc":"v1:/);
});
