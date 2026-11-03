'use strict';

const fs = require('fs');
const path = require('path');
const { loadEnvFile, resolveSecretKey } = require('./config');
const { createDesk, DeskError } = require('./desk');

function argument(name) {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
        throw new Error(`${name} is required. Usage: npm run a2a:reset-owner -- --league <leagueId> --team <teamId>`);
    }
    return process.argv[index + 1];
}

function secretForReset(persistPath) {
    const keyPath = path.join(path.dirname(persistPath), 'secret.key');
    if (process.env.A2A_SECRET_KEY || fs.existsSync(keyPath)) {
        return resolveSecretKey(process.env, keyPath);
    }
    return undefined;
}

function main() {
    loadEnvFile(path.join(__dirname, '..', '..', '.env'));
    const leagueId = argument('--league');
    const teamId = argument('--team');
    const persistPath = process.env.A2A_DATA || path.join(__dirname, '..', 'data', 'a2a-store.json');
    const desk = createDesk({
        persistPath,
        secretKey: secretForReset(persistPath)
    });
    const result = desk.resetOwnerForTeam({ leagueId, teamId });
    console.log(`Reset the owner token for ${result.teamName} (league ${result.leagueId}, team ${result.teamId}).`);
    console.log('Save this token. It is shown once and replaces the previous owner token.');
    console.log(result.ownerToken);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        const message = error instanceof DeskError ? error.message : error.message;
        console.error(message);
        process.exit(1);
    }
}

module.exports = { main };
