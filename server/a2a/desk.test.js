'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { createDesk, validateTerms } = require('./desk');

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

test('persisted desk keeps owner access and does not store raw tokens', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-desk-'));
    const persistPath = path.join(dir, 'store.json');
    const created = createDesk({ persistPath }).registerAgent({
        teamId: '9',
        teamName: 'Saved Team',
        leagueId: 'lg',
        name: 'Saver'
    });
    const reloaded = createDesk({ persistPath });
    const me = reloaded.me(created.ownerToken);
    assert.equal(me.teamName, 'Saved Team');
    assert.equal(me.role, 'owner');

    const raw = fs.readFileSync(persistPath, 'utf8');
    assert.equal(raw.includes(created.ownerToken), false);
    assert.equal(raw.includes(created.agentToken), false);
    assert.equal(reloaded.me(created.agentToken).role, 'agent');
});
