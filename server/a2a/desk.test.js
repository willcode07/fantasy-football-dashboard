'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { assertWebhookUrl, createDesk, resolveWebhookTarget, validateTerms } = require('./desk');

const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34', family: 4 }];
const SECRET_KEY = Buffer.alloc(32, 7);
const LEAGUE_CODE = 'desk-code';
const COMMISSIONER_CODE = 'desk-commissioner';

function openDesk(extra = {}) {
    return createDesk({
        leagueCode: LEAGUE_CODE,
        commissionerCode: COMMISSIONER_CODE,
        secretKey: SECRET_KEY,
        lookup: PUBLIC_LOOKUP,
        ...extra
    });
}

async function issue(desk, body, meta = {}) {
    const pending = await desk.registerAgent(body, { leagueCode: LEAGUE_CODE, ...meta });
    if (pending.status !== 'pending') return pending;
    desk.decideClaim(pending.claim.id, { commissionerCode: COMMISSIONER_CODE, decision: 'approve' });
    return desk.redeemClaim(pending.claim.id, pending.claimToken);
}

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
    const desk = openDesk({
        persistPath,
        rosters: { lg: { 9: { teamName: 'Saved Team', ownerId: 'user-9' } } }
    });
    const created = await issue(desk, {
        teamId: '9',
        teamName: 'Spoofed',
        leagueId: 'lg',
        name: 'Saver',
        webhookUrl: 'https://hooks.example.com/hook',
        webhookSecret: 'plain-secret'
    });
    const reloaded = openDesk({
        persistPath,
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
    const target = await resolveWebhookTarget('https://hooks.example.com/hook', PUBLIC_LOOKUP);
    assert.equal(target.address, '93.184.216.34');
    assert.equal(target.family, 4);
    assert.match(target.href, /^https:\/\/hooks\.example\.com\/hook/);
    const literal = await resolveWebhookTarget('https://93.184.216.34/hook');
    assert.equal(literal.address, '93.184.216.34');
    assert.equal(literal.family, 4);
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
    const desk = openDesk({
        rosters: {
            lg: {
                1: { teamName: 'Real Owners', ownerId: 'user-1' },
                2: { teamName: 'Other Team', ownerId: 'user-2' }
            }
        }
    });
    const first = await issue(desk, {
        teamId: '1',
        teamName: 'Attacker',
        leagueId: 'lg',
        name: 'Original'
    });
    assert.equal(first.agent.metadata.teamName, 'Real Owners');

    await assert.rejects(
        () => desk.registerAgent({
            teamId: '9',
            teamName: 'Missing',
            leagueId: 'lg',
            name: 'Nobody'
        }, { leagueCode: LEAGUE_CODE }),
        (error) => error.status === 404
    );
    const recovery = await desk.registerAgent({
        teamId: '1',
        teamName: 'Hijack',
        leagueId: 'lg',
        name: 'Hijack'
    }, { leagueCode: LEAGUE_CODE });
    assert.equal(recovery.status, 'pending');
    assert.equal(recovery.claim.purpose, 'rotate-owner');
    assert.equal(desk.me(first.ownerToken).role, 'owner');
    assert.equal(desk.me(first.agentToken).agent.name, 'Original');

    const other = await issue(desk, {
        teamId: '2',
        teamName: 'Other',
        leagueId: 'lg',
        name: 'Other Agent'
    });
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
        const desk = openDesk();
        const pending = await desk.registerAgent({
            teamId: '4',
            teamName: 'Spoof',
            leagueId: 'league-verified',
            name: 'Bench',
            sleeperOwnerId: 'someone-else'
        }, { leagueCode: LEAGUE_CODE });
        assert.equal(pending.status, 'pending');
        assert.equal(pending.claim.teamName, 'Bench Mob');
        assert.equal(Object.prototype.hasOwnProperty.call(pending.claim, 'rosterOwnerId'), false);
        desk.decideClaim(pending.claim.id, { commissionerCode: COMMISSIONER_CODE, decision: 'approve' });
        const created = desk.redeemClaim(pending.claim.id, pending.claimToken);
        assert.equal(created.agent.metadata.teamName, 'Bench Mob');
        global.fetch = async () => new Response('down', { status: 503 });
        await assert.rejects(
            () => desk.registerAgent({
                teamId: '1',
                teamName: 'X',
                leagueId: 'league-offline',
                name: 'X'
            }, { leagueCode: LEAGUE_CODE }),
            (error) => error.status === 404 && error.code === 'not_found'
        );
    } finally {
        global.fetch = previous;
    }
});

test('a roster claim and owner-token recovery wait for the commissioner', async () => {
    const desk = openDesk({
        rosters: {
            lg: {
                1: { teamName: 'Real Owners', ownerId: 'user-1' },
                8: { teamName: 'Orphan', ownerId: null }
            }
        }
    });
    await assert.rejects(
        () => desk.registerAgent({
            teamId: '1',
            leagueId: 'lg',
            name: 'Missing Owner',
            sleeperOwnerId: 'user-1'
        }, { leagueCode: 'wrong-code' }),
        (error) => error.status === 401 && error.code === 'unauthorized'
    );
    assert.equal(desk.listClaims({ commissionerCode: COMMISSIONER_CODE }).claims.length, 0);

    const filed = await desk.registerAgent({
        teamId: '1',
        leagueId: 'lg',
        name: 'Public Id',
        sleeperOwnerId: 'user-2'
    }, { leagueCode: LEAGUE_CODE });
    assert.equal(filed.status, 'pending');
    assert.equal(filed.ownerToken, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(filed.claim, 'rosterOwnerId'), false);
    assert.equal(desk.listClaims({ commissionerCode: COMMISSIONER_CODE, status: 'pending' }).claims[0].rosterOwnerId, 'user-1');
    await assert.rejects(
        () => desk.registerAgent({
            teamId: '1',
            leagueId: 'lg',
            name: 'Again'
        }, { leagueCode: LEAGUE_CODE }),
        (error) => error.status === 409
    );
    assert.throws(
        () => desk.decideClaim(filed.claim.id, { commissionerCode: LEAGUE_CODE, decision: 'approve' }),
        (error) => error.status === 401
    );
    assert.equal(desk.listAgents().agents.length, 0);
    const approved = desk.decideClaim(filed.claim.id, { commissionerCode: COMMISSIONER_CODE, decision: 'approve' });
    assert.equal(approved.claim.status, 'approved');
    assert.equal(approved.ownerToken, undefined);
    assert.equal(approved.agentToken, undefined);
    const first = desk.redeemClaim(filed.claim.id, filed.claimToken);
    assert.equal(typeof first.ownerToken, 'string');
    assert.equal(first.agent.metadata.teamName, 'Real Owners');
    assert.throws(
        () => desk.redeemClaim(filed.claim.id, filed.claimToken),
        (error) => error.status === 410
    );

    const orphan = await desk.registerAgent({
        teamId: '8',
        leagueId: 'lg',
        name: 'Orphan'
    }, { leagueCode: LEAGUE_CODE });
    assert.equal(orphan.status, 'pending');
    assert.equal(desk.listClaims({ commissionerCode: COMMISSIONER_CODE, status: 'pending' }).claims[0].rosterOwnerId, null);

    desk.revokeAgent(first.agent.metadata.agentId, first.ownerToken);
    const codeOnly = await desk.registerAgent({
        teamId: '1',
        leagueId: 'lg',
        name: 'Code Only'
    }, { leagueCode: LEAGUE_CODE });
    assert.equal(codeOnly.status, 'pending');
    assert.equal(desk.authenticate(first.ownerToken), null);
    const reclaimed = desk.redeemClaim(
        codeOnly.claim.id,
        codeOnly.claimToken
    );
    assert.equal(reclaimed.status, 'pending');
    desk.decideClaim(codeOnly.claim.id, { commissionerCode: COMMISSIONER_CODE, decision: 'approve' });
    const recovered = desk.redeemClaim(codeOnly.claim.id, codeOnly.claimToken);
    assert.notEqual(recovered.ownerToken, first.ownerToken);
    assert.equal(desk.me(recovered.ownerToken).role, 'owner');

    const rotation = await desk.registerAgent({
        teamId: '1',
        leagueId: 'lg',
        name: 'Recover',
        purpose: 'rotate-owner'
    }, { leagueCode: LEAGUE_CODE });
    assert.equal(rotation.claim.purpose, 'rotate-owner');
    assert.equal(desk.me(recovered.ownerToken).role, 'owner');
    desk.decideClaim(rotation.claim.id, { commissionerCode: COMMISSIONER_CODE, decision: 'approve' });
    const rotated = desk.redeemClaim(rotation.claim.id, rotation.claimToken);
    assert.equal(rotated.agentToken, null);
    assert.equal(desk.authenticate(recovered.ownerToken), null);
    assert.equal(desk.me(rotated.ownerToken).role, 'owner');
    assert.equal(desk.me(recovered.agentToken).role, 'agent');
});

test('the commissioner code cannot match the league code', () => {
    assert.throws(
        () => createDesk({ leagueCode: 'same-code', commissionerCode: 'same-code' }),
        /different from A2A_LEAGUE_CODE/
    );
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
