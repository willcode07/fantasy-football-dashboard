'use strict';

const path = require('path');
const {
    loadEnvFile,
    resolveCommissionerCode,
    resolveCorsOrigins,
    resolveLeagueCode,
    resolveListenHost,
    resolvePublicBase,
    resolveSecretKey
} = require('./config');
const { createDesk } = require('./desk');
const { createA2AServer, defaultNotify } = require('./http');

loadEnvFile(path.join(__dirname, '..', '..', '.env'));

const port = Number(process.env.PORT || 8787);
const host = resolveListenHost(process.env);
const persistPath = process.env.A2A_DATA || path.join(__dirname, '..', 'data', 'a2a-store.json');
const dataDir = path.dirname(persistPath);
const league = resolveLeagueCode(process.env, path.join(dataDir, 'league-code'));
const commissioner = resolveCommissionerCode(process.env, path.join(dataDir, 'commissioner-code'));
if (league.code === commissioner.code) {
    throw new Error('A2A_COMMISSIONER_CODE must be different from A2A_LEAGUE_CODE.');
}
const secretKey = resolveSecretKey(process.env, path.join(dataDir, 'secret.key'));
const publicBase = resolvePublicBase(process.env, port);

const desk = createDesk({
    persistPath,
    leagueCode: league.code,
    commissionerCode: commissioner.code,
    secretKey,
    notify: defaultNotify
});

const server = createA2AServer({
    desk,
    publicBase,
    corsOrigins: resolveCorsOrigins(process.env)
});

server.listen(port, host, () => {
    console.log(`A2A desk listening on http://${host}:${port}`);
    console.log(`Agent card: ${publicBase}/.well-known/agent-card.json`);
    if (league.generated) {
        console.log(`Generated league code (save this; it is not printed again): ${league.code}`);
        console.log(`Saved to ${path.join(dataDir, 'league-code')}`);
    }
    if (commissioner.generated) {
        console.log(`Generated commissioner code (save this; it is not printed again): ${commissioner.code}`);
        console.log(`Saved to ${path.join(dataDir, 'commissioner-code')}`);
    }
    console.log('A league code files a claim. The commissioner code approves it. Owner-token recovery uses that same approval.');
    console.log('Agents negotiate. Human owners approve. No roster move is sent to Sleeper.');
});
