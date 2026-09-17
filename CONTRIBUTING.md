# Contributing

Thanks for considering a contribution to Feedkeeper.

## Reporting bugs

Open an [issue](https://github.com/visualfusion/feedkeeper/issues) with:

- What you expected to happen vs. what happened
- Steps to reproduce
- Your environment (Node version, OS, browser if it's a UI issue)

For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead — please don't open a public issue.

## Suggesting features

Open an issue describing the use case, not just the feature. "I want to filter feeds by X because Y" is more useful than "add filtering."

## Development setup

```bash
git clone https://github.com/visualfusion/feedkeeper.git
cd feedkeeper
npm install
cp .env.example .env
# set SESSION_SECRET at minimum, see the comment in .env.example
npm run dev:server   # terminal 1
npm run dev:web      # terminal 2
```

See the [README](README.md#quick-start-local) for the full quick start.

## Before opening a pull request

```bash
npm run lint   # type-checks both workspaces
npm run build  # verifies the production build succeeds
```

Both run in CI on every pull request; please make sure they pass locally first.

## Pull request guidelines

- Keep PRs focused — one change per PR is easier to review than a bundle of unrelated fixes.
- Match the existing code style (no linter/formatter is enforced yet beyond TypeScript's own checks).
- If you touch user-facing text, update all three locale files (`web/src/i18n/locales/{en,de,ja}.json`), not just English. If you don't speak German or Japanese, a best-effort translation (or leaving a `// TODO: translate` note) is fine — it'll get reviewed.
- If you change the database schema, add a new migration file under `server/src/db/migrations/` rather than editing an existing one.

## Code of conduct

Be respectful and constructive. Disagreements about code are fine; personal attacks aren't.
