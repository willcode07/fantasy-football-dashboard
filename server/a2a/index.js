'use strict';

const path = require('path');
const {
    loadEnvFile,
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
const secretKey = resolveSecretKey(process.env, path.join(dataDir, 'secret.key'));
const publicBase = resolvePublicBase(process.env, port);

const desk = createDesk({
    persistPath,
    leagueCode: league.code,
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
    console.log('The league code claims an unclaimed team and returns both tokens once.');
    console.log('After that, only that team\'s owner token can replace the agent or rotate the owner token.');
    console.log('A lost owner token is reset on this host with npm run a2a:reset-owner.');
    console.log('Agents negotiate. Human owners approve. No roster move is sent to Sleeper.');
});
