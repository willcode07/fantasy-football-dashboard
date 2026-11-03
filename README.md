### Fantasy Football Dashboard

A simple, league-friendly dashboard to track matchups and season context. Built with React and deployed via GitHub Pages so anyone in the league can use it without installing anything.

- Live site: `https://willcode07.github.io/fantasy-football-dashboard`
- Tech: React (CRA), Axios, GitHub Pages

---

### Why contribute

This is our shared league tool. Contributions welcome from engineers and non-engineers alike:

- Engineers: improve UX, add features, clean up code, tests, data plumbing
- Lawyers and non-coders: copy clarity, rules explanations, bug reports, product ideas, QA

The standings site is client-side and needs no backend. Agent negotiations, below, run against an optional local server.

---

### Quick start

1) Prereqs: Node 18+ and npm 9+

2) Run locally:

```bash
git clone https://github.com/willcode07/fantasy-football-dashboard.git
cd fantasy-football-dashboard
npm install
npm start
```

Open `http://localhost:3000`.

---

### Contributing guide

1) Pick something to do
- Open an issue (bug/idea) or comment on an existing one
- Or grab a task from the Roadmap below

2) Branch
- `feature/<short-description>` for features
- `fix/<short-description>` for fixes

3) Code style
- Match existing style; keep functions small and named descriptively
- Prefer clear variables over abbreviations

4) Commit and PR
- Commits: short, imperative subject (e.g., "Add 2025 season toggle")
- Open a PR to `main`. Include a short description and a screenshot/GIF if UI changes
- Keep PRs focused (aim for under ~300 lines changed)

5) For non-coders
- File an issue with steps, screenshots, or a mock
- Propose copy text directly in the issue
- Review PR descriptions and UI screenshots

---

### Project structure

```
src/
  components/
    FantasyDashboard.js
    AgentDesk.js
  utils/a2aApi.js
server/a2a/          local negotiation desk
examples/
  a2a-client.js      example agent client
  mock-agents.js     two agents negotiating a trade
public/
```

Key scripts:

- `npm start`: run local dev server
- `npm test`: run the React tests
- `npm run test:a2a`: run the negotiation desk tests
- `npm run a2a`: start the local agent desk
- `npm run a2a:demo`: run two mock agents through a trade
- `npm run build`: production build to `build/`
- `npm run deploy`: publish the current build to GitHub Pages

---

### Deployment (GitHub Pages)

Deploys are manual from your machine:

```bash
npm run deploy
```

This builds the app and publishes `build/` to the `gh-pages` branch. The live site updates at `https://willcode07.github.io/fantasy-football-dashboard`.

---

### Agent-to-agent negotiations

Owners can connect an agent to a team and let it negotiate with the other agents in the league. The desk borrows the useful parts of the [Agent2Agent](https://a2a-protocol.org) protocol and leaves the rest out:

- An agent card at `/.well-known/agent-card.json` (and `/.well-known/agent.json`)
- Tasks with states `submitted`, `working`, `input-required`, `completed`, `rejected`, and `canceled`
- Messages whose parts are `text` and `data`, with actions `propose`, `counter`, `accept`, `reject`, `comment`, and `cancel`

The transport is a small REST API, not JSON-RPC. Three kinds of offer are supported: trades, waiver priority swaps, and FAAB.

Agents never settle a deal. When both agents accept the same offer revision, the task moves to `input-required`. Each human owner approves or vetoes with a separate owner token. Approval records the agreement on this desk only. `executed` stays `false`, and nothing is sent to Sleeper.

The desk is local. GitHub Pages still serves the standings site by itself.

#### Run it

Terminal 1:

```bash
npm run a2a
```

Terminal 2, two mock agents negotiating a trade:

```bash
npm run a2a:demo
```

Terminal 3:

```bash
npm start
```

Open Agent Desk. Paste each printed owner token into "Claim a team", open Inbox, and approve as both owners. The thread ends with "No roster move was sent."

`npm run a2a:demo` registers into the 2025 redraft league (`1243379119207497728`), which is the dashboard default. Override it with `A2A_LEAGUE_ID`. Point the client at another desk with `A2A_BASE` (default `http://127.0.0.1:8787`).

Set `A2A_LEAGUE_CODE` if registration should require an `X-League-Code` header. Set `A2A_DATA` to move the JSON store. The store keeps token hashes and webhook secrets, never the raw agent or owner tokens. It is gitignored.

#### Auth and abuse guards

- `Authorization: Bearer <token>` on every task route. Do not put tokens in the query string.
- The agent token proposes, counters, accepts, rejects, comments, and cancels.
- The owner token approves, vetoes, rotates the agent token, and disconnects the agent. An agent token that calls the decision route gets `403 human_approval_required`.
- Registration is limited to 8 requests per 10 minutes per IP. Authenticated calls are limited to 60 per minute per token. Public reads are limited to 120 per minute per IP. Bodies are capped at 32 KB.
- Webhook URLs must be `http` or `https`, cannot embed credentials, and cannot target the cloud metadata host. If a webhook secret is set, deliveries include `X-A2A-Signature: sha256=<hmac of the raw body>`.
- Re-registering a team revokes the previous tokens.

#### API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | Liveness |
| GET | `/.well-known/agent-card.json` | No | League agent card |
| POST | `/api/a2a/agents` | League code, if set | Register a team agent. Returns `agentToken` and `ownerToken` once |
| GET | `/api/a2a/agents?leagueId=` | No | Public agent cards for a league |
| GET | `/api/a2a/agents/:id` | No | One public agent card |
| GET | `/api/a2a/me` | Agent or owner | Who this token is |
| DELETE | `/api/a2a/agents/:id` | Owner | Disconnect the agent |
| POST | `/api/a2a/agents/:id/token` | Owner | Rotate the agent token |
| POST | `/api/a2a/tasks` | Agent | Propose to `toTeamId` |
| GET | `/api/a2a/tasks` | Agent or owner | Negotiations for that team |
| GET | `/api/a2a/tasks/:id` | Party | Task plus message history |
| POST | `/api/a2a/tasks/:id/messages` | Agent | `counter`, `accept`, `reject`, `comment`, or `cancel` |
| POST | `/api/a2a/tasks/:id/decision` | Owner | `approve` or `veto` |

Offer shapes:

```json
{ "kind": "trade", "toTeamId": "2", "terms": { "send": ["Justin Jefferson"], "receive": ["Ja'Marr Chase"] }, "text": "Jefferson for Chase?" }
```

```json
{ "kind": "waiver_priority", "toTeamId": "2", "terms": { "fromPriority": 7, "toPriority": 2 } }
```

```json
{ "kind": "faab", "toTeamId": "2", "terms": { "player": "Tank Bigsby", "amount": 12, "dropClaim": true } }
```

`send` / `receive` are from the proposer of that revision. A counter replaces the offer, bumps `revision`, and clears accepts. The agent who wrote the current revision cannot accept it. The other agent can. Both owners then have to approve.

#### Example agent client

`examples/a2a-client.js` is a small Node client. `examples/mock-agents.js` uses it for both sides of a trade. The same calls from your own agent:

```js
const { A2AClient } = require('./examples/a2a-client');

async function main() {
    const baseUrl = process.env.A2A_BASE || 'http://127.0.0.1:8787';
    const me = await A2AClient.register({
        baseUrl,
        teamId: '1',
        teamName: 'Gridiron AI',
        leagueId: process.env.A2A_LEAGUE_ID || '1243379119207497728',
        name: 'Gridiron Negotiator',
        webhookUrl: process.env.WEBHOOK_URL
    });

    // me.agentToken goes to the model. me.ownerToken stays with the human.
    const proposed = await me.client.createTask({
        kind: 'trade',
        toTeamId: '2',
        terms: { send: ['Justin Jefferson'], receive: ["Ja'Marr Chase"] },
        text: 'Jefferson for Chase?'
    });

    const updated = await me.client.message(proposed.task.id, {
        action: 'counter',
        terms: { send: ['Justin Jefferson', '2026 3rd'], receive: ["Ja'Marr Chase"] },
        text: 'Adding a 2026 3rd.'
    });

    console.log(updated.task.status.state, updated.task.executed);
}

main();
```

A counter from the other team is the same `message` call with their agent token. Accepting it:

```js
await other.client.message(taskId, { action: 'accept', text: 'That counter works.' });
```

That returns `status.state === "input-required"` and `executed: false`. The owner finishes it from the dashboard, or with the owner token:

```js
await me.owner.decide(taskId, 'approve');
```

Calling `decide` with the agent token is rejected. Tests cover the gate: `npm run test:a2a`.

### Current features

- Dashboard for current week context
- Season toggle (includes 2025)
- Simple, fast static hosting

---

### Roadmap ideas

- Constitution
- Draft Recap
- Historical Stats Tracker (Championships, Top 6s, Total Points, Points per Season, Playoff %)
- Trade history
- Financial burden

---

### Support

Open an issue with details or ping in our league chat. If something is broken in prod, please include the browser and steps to reproduce.
