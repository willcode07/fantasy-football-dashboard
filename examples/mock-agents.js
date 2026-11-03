'use strict';

const fs = require('fs');
const path = require('path');
const { A2AClient } = require('./a2a-client');

const DEFAULT_LEAGUE_ID = '1243379119207497728';

// Two agents negotiate one trade, then stop. Approval is left for the human owners.
async function runDemo({ baseUrl, leagueId = DEFAULT_LEAGUE_ID } = {}) {
    if (!baseUrl) throw new Error('baseUrl is required');

    const gridiron = await A2AClient.register({
        baseUrl,
        teamId: '1',
        teamName: 'Gridiron AI',
        leagueId,
        name: 'Gridiron Negotiator',
        description: 'Mocks an owner agent that shops wide receivers.'
    });
    const wolf = await A2AClient.register({
        baseUrl,
        teamId: '2',
        teamName: 'Waiver Wolf',
        leagueId,
        name: 'Waiver Wolf',
        description: 'Mocks an owner agent that answers trade offers.'
    });

    const proposed = await gridiron.client.createTask({
        kind: 'trade',
        toTeamId: '2',
        terms: {
            send: ['Justin Jefferson'],
            receive: ["Ja'Marr Chase"]
        },
        text: 'Jefferson for Chase?'
    });

    const countered = await wolf.client.message(proposed.task.id, {
        action: 'counter',
        terms: {
            send: ["Ja'Marr Chase"],
            receive: ['Justin Jefferson', '2026 3rd']
        },
        text: 'Chase for Jefferson and a 2026 3rd.'
    });

    const accepted = await gridiron.client.message(countered.task.id, {
        action: 'accept',
        text: 'That counter works.'
    });

    let agentApproval = null;
    try {
        await gridiron.client.decide(proposed.task.id, 'approve');
    } catch (error) {
        agentApproval = { status: error.status, code: error.code, message: error.message };
    }

    return {
        task: accepted.task,
        agentApproval,
        owners: [
            { teamId: '1', teamName: 'Gridiron AI', ownerToken: gridiron.ownerToken, agentToken: gridiron.agentToken },
            { teamId: '2', teamName: 'Waiver Wolf', ownerToken: wolf.ownerToken, agentToken: wolf.agentToken }
        ]
    };
}

async function main() {
    const baseUrl = process.env.A2A_BASE || 'http://127.0.0.1:8787';
    const result = await runDemo({ baseUrl, leagueId: process.env.A2A_LEAGUE_ID || DEFAULT_LEAGUE_ID });
    if (result.task.status.state !== 'input-required') {
        throw new Error(`Expected input-required, got ${result.task.status.state}`);
    }
    if (result.task.executed !== false) {
        throw new Error('The desk executed a roster move.');
    }
    if (!result.agentApproval || result.agentApproval.status !== 403) {
        throw new Error('Agent token was allowed to approve.');
    }
    console.log('Both agents accepted a trade. Status: input-required.');
    console.log(result.task.currentOffer.summary);
    console.log('No roster move was executed. Each human owner approves from Agent Desk with the owner token.');
    const session = {
        taskId: result.task.id,
        summary: result.task.currentOffer.summary,
        leagueId: process.env.A2A_LEAGUE_ID || DEFAULT_LEAGUE_ID,
        agentApproval: result.agentApproval,
        owners: result.owners.map((owner) => ({
            teamId: owner.teamId,
            teamName: owner.teamName,
            ownerToken: owner.ownerToken
        }))
    };
    const sessionPath = path.join(__dirname, '.demo-session.json');
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
    console.log(JSON.stringify(session, null, 2));
    console.log(`Wrote owner tokens to ${sessionPath}`);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}

module.exports = { DEFAULT_LEAGUE_ID, runDemo };
