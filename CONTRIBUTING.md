## Contributing

Thanks for helping improve the Fantasy Football Dashboard! Contributions are welcome from everyone in the league—engineers, lawyers, and non-coders.

### Ways to contribute
- Report bugs with steps and screenshots
- Improve copy and rules explanations
- Add small features or polish UI
- Refactor code and add tests

### Getting started
1. Fork and clone the repo
2. Install deps and run locally:
   ```bash
   npm install
   npm start
   ```
3. Create a branch:
   - `feature/<short-description>` or `fix/<short-description>`

### Coding guidelines
- Match existing code style; keep functions small and descriptive
- Prefer clear variable names over abbreviations
- Handle loading/error states
- Keep PRs focused and under ~300 LOC when possible

### Commit and PR
- Commits: short, imperative subject (e.g., "Add 2025 season toggle")
- Open a PR to `main` and fill out the PR template
- Include a screenshot/GIF for UI changes

### Local testing checklist
- No console errors or ESLint warnings
- Basic flows work on desktop and mobile viewport

### Deploys
- Maintainers deploy with:
  ```bash
  npm run deploy
  ```
  This publishes to GitHub Pages at `https://willcode07.github.io/fantasy-football-dashboard`.

### Questions
Open an issue or ask in league chat. Thanks for contributing!

