### Fantasy Football Dashboard

A simple, league-friendly dashboard to track matchups and season context. Built with React and deployed via GitHub Pages so anyone in the league can use it without installing anything.

- Live site: `https://willcode07.github.io/fantasy-football-dashboard`
- Tech: React (CRA), Axios, GitHub Pages

---

### Why contribute

This is our shared league tool. Contributions welcome from engineers and non-engineers alike:

- Engineers: improve UX, add features, clean up code, tests, data plumbing
- Lawyers and non-coders: copy clarity, rules explanations, bug reports, product ideas, QA

No backend or secrets required. All work is client-side.

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
  App.js
public/
```

Key scripts:

- `npm start`: run local dev server
- `npm test`: run tests (when present)
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
