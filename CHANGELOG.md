# Changelog

All notable changes to FeedKeeper are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/) for its releases. The full release notes, including upgrade notes, are on the [releases page](https://github.com/visualfusion/feedkeeper/releases).

## [Unreleased]

### Added
- Extension point `passwordCard`: a host that signs people in another way (single sign-on, Sign in with Apple) can replace the password card of the account page, for everyone or, with `applies`, for the users who have no password.
- Footer links can carry a small `icon` and be limited to some `placements` (`login`, `menu`, `page`), so a host no longer needs style rules to decorate or hide them.

## [0.16.2] - 2026-10-07

### Security
- The service worker stored a copy of every GET request outside `/api/` and answered with it first. FeedKeeper itself serves nothing user-specific there, but a product built on it that adds its own pages or API under another path would have shown one account another account's data in the same browser. The worker now only caches the app's static files (the files next to `index.html`) and `/assets/`; every other path goes to the network.

## [0.16.1] - 2026-10-06

### Changed
- Settings → MCP explains signing in with OAuth as the recommended way to connect ChatGPT, Claude and other apps, step by step. Tokens are now described as the second option for scripts and clients without connector support.
- The README has a quick start and a "Why FeedKeeper?" section near the top, and describes OAuth sign-in for MCP clients. The changelog is shorter.
- ESLint runs as part of `npm run lint` and in CI. Unused code and a few unnecessary regex escapes found by it were removed.

### Security
- Updated `source-map-js` and the MCP SDK (1.32.1) to clear an `npm audit` finding.

## [0.16.0] - 2026-10-06

### Added
- Extension points for the web app, for operators and products built on FeedKeeper: a script on the page can add settings sections, add footer links (such as a legal notice) and replace the sign-in form, for example with a company single sign-on. See [Extending the web app](docs/extending-the-web-app.md).

## [0.15.1] - 2026-10-06

### Fixed
- Connectors could sign in through OAuth but never complete the consent, because the form post was rejected as coming from another site. The origin check now relies on `Sec-Fetch-Site`.

### Changed
- The web app shows the new FeedKeeper wordmark next to the logo.

## [0.15.0] - 2026-10-06

### Added
- OAuth 2.1 sign-in for the remote MCP endpoint, so connectors such as ChatGPT and Claude can connect without a hand-made token: discovery metadata, dynamic client registration, authorization code flow with PKCE, refresh-token rotation and revocation. The consent page asks every time and lets you choose read-only or read and write. OAuth tokens expire (access 1 hour, refresh 30 days) and only work on `/mcp`; existing `fk_` tokens are unchanged. `OAUTH_ALLOWED_REDIRECT_HOSTS` optionally limits which hosts may register.
- Settings → MCP lists the apps that signed in through OAuth and lets you disconnect them.

## [0.14.2] - 2026-10-06

### Fixed
- Behind a CDN, all visitors of one edge shared the rate limits. `TRUST_PROXY` now accepts a list of trusted proxies (addresses, CIDR ranges, `loopback`, `linklocal`, `uniquelocal`) or a hop count, and `CLIENT_IP_HEADER` (e.g. `CF-Connecting-IP`) takes the client address from the CDN's header, as needed on Uberspace. An invalid value stops the server at startup.

## [0.14.1] - 2026-10-05

### Fixed
- A memory leak during full-text extraction in long-running processes, and much faster extraction and background queue queries on small servers.

## [0.14.0] - 2026-10-05

### Added
- Background preparation of articles for every reader: persistent jobs, per-article extraction outcomes with retry times, and content changes in native sync. Selected articles can be prepared through `POST /api/v1/items/prepare`.
- MCP: long articles can be read in parts (HTML or plain text) with revision checks, so nothing is silently cut off.

### Changed
- Full-text preparation prioritizes active editions, saved articles and notes, using at most two concurrent requests and one per host.
- Paywalls and consent walls are remembered per article instead of disabling a whole feed; richer stored content is not replaced by shorter extracts.
- All article images go through the server's image proxy, still with SSRF and ownership checks.

### Fixed
- Full-text search stays consistent when only an article's metadata changes.

## [0.13.0] - 2026-10-05

### Added
- Universal Inbox (read it later): save web pages, URLs and notes to a personal inbox with automatic text and image archiving (`POST /api/v1/inbox`, MCP tool `save_to_inbox`). Inbox items are exempt from cleanup.
- Edition overviews with up to five topics and validated article links, for MCP publishers and native clients.

### Fixed
- Setting section preferences no longer overrides the default article count of an edition.

## [0.12.0] - 2026-10-04

### Added
- Account capabilities: `GET /api/v1/me` and `GET /api/auth/me` list the features of an account, so clients can adapt. Hosted or downstream distributions can plug in their own capability rules; the open source server grants everything.
- A ready-made Claude Desktop and Cowork configuration in the MCP settings, token included.

### Changed
- Disabling a feature never deletes stored content; notes and editions stay readable and notes can still be exported or deleted.

## [0.11.0] - 2026-10-04

### Added
- Automatic editions for native apps: up to 24 unread stories chosen by freshness, preferred sections, source diversity and duplicate detection, in morning, midday and evening issues.
- App-only reading preferences (`/api/v1/native-preferences`) that sync section order, newspaper visibility and edition size without touching the web reader.
- Edition endpoints and MCP tools (`get_edition`, `get_edition_candidates`, `generate_edition`, `dismiss_edition`, `get_native_preferences`, `update_native_preferences`) so agents can inspect, curate and publish an issue with revision checks and safe retries.

### Changed
- Curated editions take priority over automatic ones until they expire (24 hours by default, at most seven days).
- Feed icons prefer SVG and the largest declared icons, including web app manifests; SVG icons are stored as 512-pixel PNGs.

## [0.10.1] - 2026-10-03

### Changed
- Feed icons from SVG and ICO sources are stored as PNG so web and native clients share one image.

### Fixed
- Deleting a note detects edits from another device.
- Feed icons are rechecked about once a week, even when the feed returns 304.

## [0.10.0] - 2026-10-03

### Added
- Full-text search with SQLite FTS5 (`GET /api/v1/search`) over titles, snippets, cached full text and notes, ranked by BM25, diacritic-insensitive, with phrase support.
- Article notes in Markdown, synced across devices, exportable as files, and exempt from cleanup.
- A curated daily edition (`GET /api/v1/edition`) that MCP clients can assemble with `publish_edition`.
- Feed icons served by the server with hashes and ETags, and SF Symbols for folders.
- Retention rules in `GET /api/v1/meta`, so offline clients can mirror the server's housekeeping.

## [0.9.0] - 2026-10-02

### Added
- Groundwork for native apps: `GET /api/v1/meta`, device pairing with a QR code (Settings → Devices) and a revocable token per device. See `docs/design/native-api.md`.
- Incremental sync (`GET /api/v1/sync`) and idempotent offline changes (`POST /api/v1/mutations`), plus subscriptions, folders, muted keywords, articles, full text, images, OPML and an overview under `/api/v1`, described in `docs/openapi.yaml`.
- MCP: `get_digest`, `get_overview`, the `maxChars` option of `get_item`, shorter `get_new_items` results, push settings in `update_feed`, prompts (`daily_briefing`, `catch_up_on_topic`, `saved_reading_list`, `triage_unread`) and resources.

## [0.8.0] - 2026-10-02

### Added
- A service worker: the installed app starts without a connection and shows the articles, feeds and images you loaded last, with an offline notice. Cached account data is removed on logout.
- An offline copy keeps your saved articles (up to 300) and the newest 100 unread ones on the device with their full text and images, so they can be read, searched and filtered without a connection. Images of articles that are not archived are fetched through the server, which only serves images an article itself shows. A setting turns the offline copy off.
- Marking read and saving work offline: the changes are kept and sent when the connection is back.
- Web Push notifications for new articles, switched on per feed (Feeds → Edit) and per device (Settings), with a test button. Articles that match your muted keywords are not announced, and a feed's first fetch stays silent. A tap opens the article directly when there is one new article, otherwise the feed.
- The number of unread articles on the app icon, switched on per feed (off by default), and home screen shortcuts for saved articles and adding a feed.
- Sharing a web address from another app (Android and desktop Chromium) opens the add-feed dialog with it filled in.
- Feed icons are delivered through the server, so they also show offline and no third-party site is contacted when you browse.
- A database migration adds the notification and icon count settings and the registered devices; the server's push keys are created on first start.
- Prebuilt multi-architecture Docker images (`amd64` and `arm64`) published to the GitHub Container Registry, so FeedKeeper runs without cloning or building.
- Contribution guides for translations, a code of conduct, and a check that all languages contain the same text keys.

### Changed
- Built files are served with long-lived cache headers.
- `compose.yaml` pulls the published image. Building from source moved to `compose.build.yaml`.

### Fixed
- The article reader shows the source once, in its header.

### Security
- Push delivery checks every connection it makes, so a registered notification address cannot lead into the server's own network.

## [0.7.0] - 2026-10-01

### Added
- Saved articles are a lasting archive: saving keeps the full text and stores the images next to the database (`ARCHIVE_PATH`).
- Saved articles survive cleanups and unsubscribing, ignore the word filter, and their full text is searchable.
- Backups and restores include the archive folder.

### Changed
- Saving an article is called "Save for later" everywhere, including the MCP tool descriptions.
- The saved view lists articles in the order they were saved and shows read and unread ones.
- The README shows screenshots on iPhone and iPad.

## [0.6.1] - 2026-10-01

### Fixed
- Pull to refresh works again on phones, including when the pull starts on a newspaper card.

### Added
- A refresh button in the article list on tablets and desktops, with feedback about checked feeds and new articles.

## [0.6.0] - 2026-10-01

### Added
- A redesigned feeds page with search, filters by category or errors, and actions in a menu.
- Settings organized into sections with a sidebar on desktop, and a connection guide for MCP clients.
- Per-feed full-text switch, and memory for sites that answer with a cookie or subscription wall.
- MCP: `fetch_full_text`, `update_feed`, `rename_folder`, `delete_folder`, batch changes for up to 200 items, and `since`/`until` filters.
- A splash screen while the app starts.

### Changed
- Feed discovery checks every candidate before subscribing and finds feeds listed on a site's feed overview page.
- Phones always use the newspaper layout; the reader header is translucent.

### Fixed
- HTML entities in titles and feed names, missing site icons, and flickering images while scrolling.

## [0.5.0] - 2026-09-30

### Added
- A newspaper view next to the list view, and a redesigned header with an account menu.
- Display name and profile photo per account.
- Pull to refresh, an install option for the home screen, and new app icons.
- `npm run db:backup` and `npm run db:restore` for verified online backups.
- Read-only personal access tokens, and MCP tools `list_items`, `get_item`, `mark_unread` and `mark_all_read` with cursor paging.

### Changed
- Full-text fetching no longer identifies as Googlebot.

## [0.4.1] - 2026-09-29

### Security
- The IP of every feed and article connection is validated, including redirects, so DNS changes cannot bypass the private-network guard.
- Article HTML is sanitized with DOMPurify and the script policy is tighter.

### Changed
- Docker Compose requires an instance-specific `SESSION_SECRET`; more settings are configurable for Docker installs.
- `ALLOW_PRIVATE_FEEDS=true` allows feeds on private networks for trusted instances.

### Fixed
- Articles beyond the first 50 load, and literal search, muted keywords and feed ordering behave correctly.

## [0.4.0] - 2026-09-29

### Added
- Feed folders with custom ordering and unread counts, kept in OPML import and export.
- An in-app article reader with full-text fetching on demand and keyboard navigation.
- Mobile tab navigation and a home-screen manifest.
- MCP tools `list_folders`, `create_folder` and `move_feed_to_folder`.

### Changed
- Node.js 22.22.2+, 24.15+ or 26+ is required.

## [0.3.0] - 2026-09-28

### Added
- Feed auto-discovery from website addresses, with a picker when a site offers several feeds.
- Retention settings and automated daily housekeeping with SQLite `VACUUM`.
- Bookmarks, protected from cleanup, with a saved filter.
- Muted keywords per user.
- MCP tools `discover_feeds`, `bookmark_item`, `unbookmark_item`, the muted keyword tools and `cleanup_database`.

## [0.2.0] - 2026-09-27

### Added
- OPML 2.0 import and export.
- Feed health badges, error details and manual refresh.
- Docker and Docker Compose support with a health endpoint.
- MCP tools `export_opml`, `import_opml` and `refresh_feed`.

## [0.1.0] - 2026-09-17

First public release: an RSS and Atom reader with a remote MCP server, multi-user accounts, a trilingual interface (English, German, Japanese), SSRF-guarded feed fetching and a single-file SQLite database.

[Unreleased]: https://github.com/visualfusion/feedkeeper/compare/v0.16.2...HEAD
[0.16.2]: https://github.com/visualfusion/feedkeeper/compare/v0.16.1...v0.16.2
[0.16.1]: https://github.com/visualfusion/feedkeeper/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/visualfusion/feedkeeper/compare/v0.15.1...v0.16.0
[0.15.1]: https://github.com/visualfusion/feedkeeper/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/visualfusion/feedkeeper/compare/v0.14.2...v0.15.0
[0.14.2]: https://github.com/visualfusion/feedkeeper/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/visualfusion/feedkeeper/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/visualfusion/feedkeeper/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/visualfusion/feedkeeper/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/visualfusion/feedkeeper/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/visualfusion/feedkeeper/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/visualfusion/feedkeeper/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/visualfusion/feedkeeper/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/visualfusion/feedkeeper/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/visualfusion/feedkeeper/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/visualfusion/feedkeeper/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/visualfusion/feedkeeper/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/visualfusion/feedkeeper/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/visualfusion/feedkeeper/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/visualfusion/feedkeeper/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/visualfusion/feedkeeper/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/visualfusion/feedkeeper/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/visualfusion/feedkeeper/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/visualfusion/feedkeeper/releases/tag/v0.1.0
