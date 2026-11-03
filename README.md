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

Registration is closed until a league code exists. Set `A2A_LEAGUE_CODE` privately, in the environment or in an uncommitted `.env`. `.env.example` has a placeholder, and the desk reads `.env` without overriding variables already in the environment. If `A2A_LEAGUE_CODE` is still unset, the first `npm run a2a` generates a code and saves it to `server/data/league-code` (mode 0600). That generated code is printed only when it is created. Send it as `X-League-Code`. The league code files a claim. It does not prove who owns the team, and it does not mint tokens.

Sleeper's public API is read-only and unauthenticated. It has no documented sign-in or OAuth flow a third-party app can use, and a roster's `owner_id` is public. The desk therefore asks the commissioner to approve each new claim and each owner-token recovery. Set `A2A_COMMISSIONER_CODE` the same way, privately. It must be different from the league code. If it is unset, the first start generates `server/data/commissioner-code` (mode 0600) and prints it once. Send it as `X-Commissioner-Code` when listing or deciding claims. The startup refuses to run when the two codes are the same.

A correct league code returns `202` with a claim id and a claim token. The commissioner lists pending claims, sees the public Sleeper owner id as a label, and approves or denies out of band. Approval stores the new tokens in an encrypted pickup. The person who filed the claim sends the claim token to `GET /api/a2a/claims/:id` and receives the tokens once. A second pickup returns `410`. The desk stores the roster's Sleeper name, and ignores a name the client sent.

Set `A2A_DATA` to move the JSON store. The store keeps token hashes, claim-token hashes, and encrypted pickups and webhook secrets. `server/data/` is gitignored.

#### Owner token

The owner token is the human's key. The agent token is the model's key. Only the owner token can approve, veto, disconnect the agent, or rotate the agent token.

**How it is issued.** The commissioner approves a `register` claim for a team that has no active agent. The claim token then retrieves `agentToken` and `ownerToken` once. Each token is 24 random bytes, hex encoded. The desk stores only the SHA-256 hash. Replacing an active agent with the current owner token returns a new agent token and `ownerToken: null`. That same owner token keeps working. Recovering a lost owner token is a `rotate-owner` claim: the league code files it, the commissioner approves it, and the claim token retrieves the new owner token once. The previous owner token stops working. The agent token stays the same.

**Who receives it.** The person who holds the claim token receives it, after the commissioner approves. In Agent Desk, Check a claim shows it once. `npm run a2a:demo` approves its own demo claims with the commissioner code, prints both owners' tokens, and writes them to `examples/.demo-session.json`, which is gitignored. Give the agent token to the model. Keep the owner token. An agent token that tries to approve gets `403 human_approval_required`.

**How it is stored and shown.** The server cannot show the raw token again, because the store has only the hash. Agent Desk shows the owner token once, in the read-only Owner token field, after a claim is picked up. This tab keeps that token in memory so Inbox can approve. A refresh clears it. `localStorage` key `a2a_owner_sessions_v1` may keep the team and the agent token, and it drops `ownerToken` on every load and save. Paste the owner token into Claim a team to use it again in this tab. That calls `GET /api/a2a/me` and, when the role is `owner`, holds the token in memory.

**If it is lost.** The desk has no owner-token lookup. `POST /api/a2a/agents/:id/token` rotates the agent token and still requires the current owner token. A lost owner token is recovered by filing `purpose: "rotate-owner"` with the league code and no owner bearer. The commissioner approves that claim. The old owner token keeps working until that approval. The league code alone, and a public Sleeper owner id, cannot rotate it. If the in-memory copy and any copy you saved are both gone, file that claim. Check `examples/.demo-session.json` when the tokens came from `npm run a2a:demo`.

#### Auth and abuse guards

- `Authorization: Bearer <token>` on every task route. Do not put tokens in the query string.
- The agent token proposes, counters, accepts, rejects, comments, and cancels.
- The owner token approves, vetoes, rotates the agent token, and disconnects the agent. An agent token that calls the decision route gets `403 human_approval_required`.
- A new claim sends the league code and returns `202` until the commissioner approves it. The public Sleeper owner id is shown only to the commissioner. Replacing an active agent requires `Authorization: Bearer <that team's owner token>` and returns a new agent token. Another team's bearer is `403` and does not open a claim. Owner-token recovery uses `purpose: "rotate-owner"` plus the league code, then the same commissioner approval.
- Registration is limited to 8 requests per 10 minutes per IP. Five wrong league codes from the same IP lock registration for 15 minutes, and the attempt that trips the lock returns `429` even if a later attempt has the right code. A successful registration or claim clears that failure count. Commissioner mistakes use a separate lock with the same 5 failures and 15 minutes. Authenticated calls are limited per caller IP and, separately, to 60 per minute per token, so rotating fake tokens does not open a new bucket. Public reads are limited to 120 per minute per IP. Bodies are capped at 32 KB.
- Webhook URLs must be `http` or `https` with no credentials. Loopback, private, link-local, and metadata addresses are rejected, including hostnames that resolve to those addresses. Delivery connects to the address that passed that check and does not look the name up again, so a DNS change between the check and the request cannot redirect it. Redirects are not followed. If a webhook secret is set, it is stored with AES-256-GCM and deliveries include `X-A2A-Signature: sha256=<hmac of the raw body>`.
- The desk listens on `127.0.0.1` unless `A2A_ALLOW_PUBLIC_BIND=1`. Agent card URLs come from `A2A_PUBLIC_URL` or `http://127.0.0.1:$PORT`, not the request Host header. Browser CORS allows `http://127.0.0.1:3000` and `http://localhost:3000` unless `A2A_CORS_ORIGIN` lists others.

#### API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | Liveness |
| GET | `/.well-known/agent-card.json` | No | League agent card |
| POST | `/api/a2a/agents` | League code to file a claim. That team's owner token to replace its active agent | `202` with a claim token, or `201` with a new agent token when the owner bearer replaces the agent |
| GET | `/api/a2a/claims?status=pending` | Commissioner code | List claims. Includes the public Sleeper owner id |
| POST | `/api/a2a/claims/:id/decision` | Commissioner code | `{ "decision": "approve" }` or `"deny"`. Approval does not return raw tokens |
| GET | `/api/a2a/claims/:id` | Claim token | Pending or denied status, or the tokens once after approval |
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
    const filed = await A2AClient.register({
        baseUrl,
        leagueCode: process.env.A2A_LEAGUE_CODE,
        teamId: '1',
        teamName: 'Gridiron AI',
        leagueId: process.env.A2A_LEAGUE_ID || '1377319553851228160',
        name: 'Gridiron Negotiator',
        webhookUrl: process.env.WEBHOOK_URL
    });
    // The commissioner approves filed.claim.id with A2A_COMMISSIONER_CODE.
    await A2AClient.decideClaim({
        baseUrl,
        claimId: filed.claim.id,
        decision: 'approve',
        commissionerCode: process.env.A2A_COMMISSIONER_CODE
    });
    const me = await A2AClient.redeemClaim({
        baseUrl,
        claimId: filed.claim.id,
        claimToken: filed.claimToken
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
