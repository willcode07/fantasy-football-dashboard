'use strict';

const path = require('path');
const { createDesk } = require('./desk');
const { createA2AServer, defaultNotify } = require('./http');

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const persistPath = process.env.A2A_DATA || path.join(__dirname, '..', 'data', 'a2a-store.json');

const desk = createDesk({
    persistPath,
    leagueCode: process.env.A2A_LEAGUE_CODE || null,
    notify: defaultNotify
});

const server = createA2AServer({ desk });

server.listen(port, host, () => {
    console.log(`A2A desk listening on http://${host}:${port}`);
    console.log(`Agent card: http://${host}:${port}/.well-known/agent-card.json`);
    console.log('Agents negotiate. Human owners approve. No roster move is sent to Sleeper.');
});
