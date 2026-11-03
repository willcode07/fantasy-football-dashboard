'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const { createDesk } = require('./desk');

const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34', family: 4 }];

test('the host CLI resets a lost owner token and is not an HTTP route', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-cli-'));
    const persistPath = path.join(dir, 'store.json');
    const secretKey = crypto.createHash('sha256').update('cli-secret').digest();
    const desk = createDesk({
        persistPath,
        leagueCode: 'cli-league',
        secretKey,
        lookup: PUBLIC_LOOKUP,
        rosters: { lg: { 2: { teamName: 'Waiver Wolf', ownerId: 'user-2' } } }
    });
    const created = await desk.registerAgent({
        teamId: '2',
        leagueId: 'lg',
        name: 'Wolf'
    }, { leagueCode: 'cli-league' });

    const child = spawnSync(process.execPath, [
        path.join(__dirname, 'reset-owner.js'),
        '--league',
        'lg',
        '--team',
        '2'
    ], {
        env: {
            ...process.env,
            A2A_DATA: persistPath,
            A2A_SECRET_KEY: 'cli-secret'
        },
        encoding: 'utf8'
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.includes(created.ownerToken), false);
    const token = child.stdout.trim().split('\n').pop();
    assert.equal(token.length > 16, true);

    const reloaded = createDesk({
        persistPath,
        leagueCode: 'cli-league',
        secretKey,
        lookup: PUBLIC_LOOKUP,
        rosters: { lg: { 2: { teamName: 'Waiver Wolf', ownerId: 'user-2' } } }
    });
    assert.equal(reloaded.authenticate(created.ownerToken), null);
    assert.equal(reloaded.me(token).role, 'owner');
    assert.equal(reloaded.me(created.agentToken).role, 'agent');
    await assert.rejects(
        () => reloaded.registerAgent({
            teamId: '2',
            leagueId: 'lg',
            name: 'Takeover'
        }, { leagueCode: 'cli-league' }),
        (error) => error.status === 403
    );

    const missing = spawnSync(process.execPath, [path.join(__dirname, 'reset-owner.js')], {
        env: { ...process.env, A2A_DATA: persistPath },
        encoding: 'utf8'
    });
    assert.notEqual(missing.status, 0);

    const httpSource = fs.readFileSync(path.join(__dirname, 'http.js'), 'utf8');
    assert.equal(httpSource.includes('resetOwner'), false);
    assert.equal(httpSource.includes('reset-owner'), false);
});
