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

### Tests

GitHub Actions runs this on every push and pull request. There is one workflow, `.github/workflows/ci.yml`: install, lint, the Jest suite, the agent-desk tests, and a production build.

```bash
npm run lint
npm test -- --watchAll=false
npm run test:a2a
npm run build
```

`npm test` is the React suite (standings, Agent Desk, and the dashboard smoke tests). `npm run test:a2a` is the Node test runner for the negotiation server. The dashboard treats the calendar year as the live season. 2026 is that season: redraft league `1377319553851228160` and dynasty league `1317708035182858240`. A browser that still has the old 2025 default is moved to 2026 once; choosing another year in the season menu keeps that choice. Dashboard tests pin the clock to 15 Oct 2026 so 2026 stays the live season, and an unpinned clock changes which weeks the app fetches.

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
cp .env.example .env
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

`npm run a2a:demo` registers into the 2026 redraft league (`1377319553851228160`), which is the dashboard default. Override it with `A2A_LEAGUE_ID`. Point the client at another desk with `A2A_BASE` (default `http://127.0.0.1:8787`).

Registration is closed until a league code exists. Copy `.env.example` to `.env` so `A2A_LEAGUE_CODE` is `226`, or set that variable yourself. The desk reads `.env` without overriding variables already in the environment. If `A2A_LEAGUE_CODE` is still unset, the first `npm run a2a` generates a code and saves it to `server/data/league-code` (mode 0600). That generated code is printed only when it is created. Send the code as `X-League-Code` when claiming a team that does not have an agent yet. The desk checks the roster against Sleeper and stores that roster's name, not the name the client sent. A new claim, including a claim after the agent was disconnected, also has to send `sleeperOwnerId` matching that roster's Sleeper `owner_id`.

Set `A2A_DATA` to move the JSON store. The store keeps token hashes and an encrypted webhook secret, never the raw agent token, owner token, or webhook secret. `server/data/` is gitignored.

#### Owner token

The owner token is the human's key. The agent token is the model's key. They are created together, and only the owner token can approve, veto, disconnect the agent, or rotate the agent token.

**How it is issued.** The first successful claim of a roster creates both tokens. That claim sends the league code and `sleeperOwnerId` for a team that does not already have an active agent. The desk returns `agentToken` and `ownerToken` in that response and nowhere else. Each token is 24 random bytes, hex encoded. The desk then stores only the SHA-256 hash of each token. Replacing an active agent with the current owner token returns a new agent token and `ownerToken: null`. The same owner token keeps working. Disconnecting the agent and claiming the roster again issues a new owner token, and the previous one stops working.

**Who receives it.** The person who registers the team receives it, in the registration response. In Agent Desk that is the owner who clicks Connect agent. `npm run a2a:demo` prints both owners' tokens and writes them to `examples/.demo-session.json`, which is gitignored. Give the agent token to the model. Keep the owner token. An agent token that tries to approve gets `403 human_approval_required`.

**How it is stored and shown.** The server cannot show the raw token again, because the store has only the hash. Agent Desk shows the owner token once, in the read-only Owner token field, immediately after a new claim. The page tells you to save it. The same browser then keeps a copy in `localStorage` under `a2a_owner_sessions_v1`, along with the team and the latest agent token, until you click Forget or Disconnect. Forget removes only that browser copy. Disconnect revokes the agent on the desk and then removes the copy. The "Claimed in this browser" list shows the agent token, not the owner token. Pasting a token into Claim a team calls `GET /api/a2a/me`. If the role is `owner`, the browser saves the session and Inbox can approve with it.

**If it is lost.** There is no lookup and no owner-token rotation route. `POST /api/a2a/agents/:id/token` rotates the agent token, and it still requires the owner token. Check the places a copy may already exist:

1. This browser's `localStorage` key `a2a_owner_sessions_v1`, if you have not clicked Forget or Disconnect. The owner token is the `ownerToken` field for that team.
2. `examples/.demo-session.json`, if the tokens came from `npm run a2a:demo`.
3. Anywhere you copied it when it was first shown.

If you still have the token, use it as-is. To replace it, Disconnect that agent (or `DELETE /api/a2a/agents/:id` with the owner token) and claim the roster again with the league code and the Sleeper user id. The new response includes a new owner token. If no copy remains while the agent is still active, the desk cannot mint another one. The league code alone cannot revoke that agent or replace its owner token.

#### Auth and abuse guards

- `Authorization: Bearer <token>` on every task route. Do not put tokens in the query string.
- The agent token proposes, counters, accepts, rejects, comments, and cancels.
- The owner token approves, vetoes, rotates the agent token, and disconnects the agent. An agent token that calls the decision route gets `403 human_approval_required`.
- The first claim of a roster needs the league code and `sleeperOwnerId` equal to that roster's Sleeper owner id. The same pair is required to claim the roster again after the agent is disconnected. A wrong or missing owner id is rejected and the real owner id is not echoed back. After a claim, the league code cannot revoke the agent or mint a new owner token. Replacing an active agent requires `Authorization: Bearer <that team's owner token>` and does not require the Sleeper user id again. The same owner token keeps working. The previous agent token stops working. Another team's owner token cannot replace it.
- Registration is limited to 8 requests per 10 minutes per IP. Five wrong league codes from the same IP lock registration for 15 minutes, and the attempt that trips the lock returns `429` even if a later attempt has the right code. A successful registration clears that failure count. Owner-id mismatches do not count toward the lock. Authenticated calls are limited per caller IP and, separately, to 60 per minute per token, so rotating fake tokens does not open a new bucket. Public reads are limited to 120 per minute per IP. Bodies are capped at 32 KB.
- Webhook URLs must be `http` or `https` with no credentials. Loopback, private, link-local, and metadata addresses are rejected, including hostnames that resolve to those addresses. Delivery connects to the address that passed that check and does not look the name up again, so a DNS change between the check and the request cannot redirect it. Redirects are not followed. If a webhook secret is set, it is stored with AES-256-GCM and deliveries include `X-A2A-Signature: sha256=<hmac of the raw body>`.
- The desk listens on `127.0.0.1` unless `A2A_ALLOW_PUBLIC_BIND=1`. Agent card URLs come from `A2A_PUBLIC_URL` or `http://127.0.0.1:$PORT`, not the request Host header. Browser CORS allows `http://127.0.0.1:3000` and `http://localhost:3000` unless `A2A_CORS_ORIGIN` lists others.

#### API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | Liveness |
| GET | `/.well-known/agent-card.json` | No | League agent card |
| POST | `/api/a2a/agents` | League code plus `sleeperOwnerId` to claim a roster. That team's owner token to replace its active agent | Register a team agent. The first claim returns `agentToken` and `ownerToken` once. Replacement returns a new `agentToken` and does not return a new owner token |
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
        leagueCode: process.env.A2A_LEAGUE_CODE,
        teamId: '1',
        teamName: 'Gridiron AI',
        leagueId: process.env.A2A_LEAGUE_ID || '1377319553851228160',
        sleeperOwnerId: process.env.SLEEPER_OWNER_ID,
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
- Season toggle (live season is 2026; earlier years stay in the menu)
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
