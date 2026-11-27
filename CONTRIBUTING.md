# Contributing

Thanks for considering a contribution to FeedKeeper. Please also read our [code of conduct](CODE_OF_CONDUCT.md).

## Reporting bugs

Open an [issue](https://github.com/visualfusion/feedkeeper/issues/new/choose) with:

- What you expected to happen vs. what happened
- Steps to reproduce
- Your FeedKeeper version (shown in the release you installed, or the Docker image tag), how you run it, and your browser if it's a UI issue

For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead; please don't open a public issue.

## Suggesting features

Open an issue describing the use case, not just the feature. "I want to filter feeds by X because Y" is more useful than "add filtering."

## Suggesting feeds for the starter lists

People without feeds see lists of well-known sources by interest. A new feed, a feed that has gone quiet or a new topic is a small pull request against one file. What belongs in a list and how to write an entry is in [docs/feed-lists.md](docs/feed-lists.md).

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

See the [README](README.md#quick-start-local-development) for the full quick start.

## Before opening a pull request

```bash
npm run lint   # type-checks both workspaces and runs ESLint
npm test       # server and web tests
npm run build  # verifies the production build succeeds
```

All three run in CI on every pull request; please make sure they pass locally first. If you fix a bug or add behavior, add a test next to the existing ones in `server/test/` or `web/test/`.

## Codebase architecture

FeedKeeper is an npm workspace with two packages:

- `server/`: Express + TypeScript backend.
  - `src/db/`: SQLite setup with `better-sqlite3` and incremental migrations (`src/db/migrations/`).
  - `src/feeds/`: Polling scheduler (`poller.ts`), feed parser/fetcher, auto-discovery, SSRF guard, OPML generator/parser, and housekeeping (`cleanup.ts`).
  - `src/api/`: REST endpoints for feeds, items, bookmarks, keyword filters, folders, users, and retention settings.
  - `src/feeds/content/`: Small rules that turn embeds into links and remove clutter around an article, with pattern lists per language. See [content rules](docs/content-rules.md) for how to add one.
  - `src/feeds/archive.ts`: Keeps saved articles readable by storing their full text and images.
  - `src/mcp/`: Remote Model Context Protocol server exposing tools over Streamable HTTP (`/mcp`).
- `web/`: Single-page app built with Vite, React, and Tailwind CSS (installable as a PWA).
  - `src/pages/`: Feeds, Items, Settings, and Auth views.
  - `src/i18n/`: Translations in `en.json`, `de.json`, `ja.json`, and `ru.json`.

## Pull request guidelines

- Keep PRs focused: one change per PR is easier to review than a bundle of unrelated fixes.
- Match the existing code style. ESLint (`npm run lint`) catches unused code and common mistakes; there is no automatic formatter yet. Warnings about React hook dependencies are known and do not block a pull request.
- If you touch user-facing text, update all four locale files (`web/src/i18n/locales/{en,de,ja,ru}.json`), not just English; a test fails when their keys differ. If you don't speak German, Japanese, or Russian, a best-effort translation is fine and will get reviewed. See [docs/translating.md](docs/translating.md) to improve or add a language.
- User-visible changes get a line under "Unreleased" in [CHANGELOG.md](CHANGELOG.md).
- Commit messages are a short conventional subject, for example `fix(server): reject empty feed titles` or `feat(web): add a refresh button`.
- If you change the database schema, add a new migration file under `server/src/db/migrations/` rather than editing an existing one.

## Code of conduct

Be respectful and constructive. See the [code of conduct](CODE_OF_CONDUCT.md).
