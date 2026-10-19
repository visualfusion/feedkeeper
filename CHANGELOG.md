# Changelog

All notable changes to FeedKeeper are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/) for its releases. The full release notes, including upgrade notes, are on the [releases page](https://github.com/visualfusion/feedkeeper/releases).

## [Unreleased]

## [0.28.4] - 2026-10-18

### Fixed
- Resolve lazy-loaded images in article extraction: convert `data-lazy-src`, `data-src`, `data-original`, and responsive `data-lazy-srcset` / `data-srcset` attributes into standard `src` and `srcset` attributes before readability extraction. Inline images on WordPress blogs and publishers using client-side lazy loaders are no longer omitted or replaced with empty placeholders.
- Add diagnostic logging for article image proxy failures: log upstream fetch errors (such as publisher WAF challenges or network timeouts) to aid troubleshooting without exposing internal network details to clients.

## [0.28.3] - 2026-10-18

### Fixed
- Feed auto-discovery resilience: parsing network or HTTP errors (such as Cloudflare challenges on website landing pages) no longer abort the entire discovery pipeline, allowing alternate common feed paths to be probed.
- Feed candidate paths: added trailing-slash paths `/feed/` and `/rss/` to common feed discovery probes and probe trailing slash URL variants when direct feed inspection returns no result.
- Subscription error reporting: distinguish feed poll failures during initial subscription so clients receive specific errors (such as HTTP 403 or network errors) instead of generic no-feeds-found errors.

## [0.28.2] - 2026-10-18

### Fixed
- Exclude textless media and read-more-only entries from edition candidates and publication, regardless of publisher. Keep short reports and transcripts eligible, and leave library entries and existing editions unchanged.
- Remove repeated author and date lines wrapped in standalone inline elements from reader content. Keep author attribution when no author is available separately, and preserve inline mentions within the story.

## [0.28.1] - 2026-10-17

### Fixed
- Remove orphan product-card headers and empty ad-slot labels, including wrappers left by full-text extraction, with German, English and Japanese label recognition. Preserve actual advertising, affiliate disclosures and sponsored-article labels.
- Collapse identical adjacent desktop/mobile image copies in reader HTML while preserving distinct sources, links, responsive sources, captions and repetitions separated by text. Stored publisher HTML remains unchanged.

## [0.28.0] - 2026-10-17

### Added
- Empty gallery filtering: a gallery term in the URL path together with empty or read-more-only feed/body text marks an item as an empty gallery. Normal lists, search, notifications and edition curation omit these entries; short articles and photo captions remain visible. Bookmarked or annotated items remain in lists/search, and direct reads and sync retain the original data.
- Native clients can inspect `content.isEmptyGallery` (advertised by `item.empty-gallery`). Reclassification advances the content revision and emits an ordinary `item_content` sync update rather than a deletion.

### Fixed
- Isolate web offline article snapshots and queued changes by authenticated account. Clear private service-worker responses on login, expired sessions and account switches, and prevent late responses from refilling a later session's cache. Refresh account bindings across browser tabs.

### Upgrade notes
- Legacy web offline copies without account ownership are discarded; sign in online once to download a fresh account-bound copy.
- Migration `0040_empty_gallery.sql` adds the classification and schedules existing articles for the bounded metadata backfill. Existing entries are classified gradually after startup; new/updated feed entries and downloaded full text are classified immediately. No publisher content, saved state, notes or existing editions are removed. Subscription unread counts keep their existing raw-count semantics, as with keyword filtering.

## [0.27.2] - 2026-10-16

### Changed
- Database performance tuning: SQLite connections configure WAL pragmas (`synchronous = NORMAL`, `busy_timeout = 5000`, `temp_store = MEMORY`, `cache_size = -65536`) for lower disk latency during concurrent writes.
- Change log hydration and sequence tracking: change entity lookups for item content, read/bookmark states and notes are batched into single queries instead of separate lookups per change row. Monotonic sequence numbers survive change log pruning through dedicated triggers and `sync_state.last_seq`.
- Query planning and memory footprint: item search separates article ID ranking and pagination into a common table expression before joining full HTML columns, avoiding large text copies in temporary sort tables. Unused feed and retention cleanup queries avoid correlated subqueries over JSON arrays.
- Reader noise cleanup and worker scheduling: leading character counting short-circuits once the beginning of the article is passed, eliminating quadratic range traversals. Full-text worker queues back off adaptively, and image cache lookups reject known missing images immediately before queueing.

### Fixed
- FTS5 update trigger: the update trigger for full-text search columns matches the virtual table's schema, avoiding index inconsistencies during article updates.
- Token and OAuth touch throttling: access token and OAuth grant `last_used_at` timestamps are throttled in-memory to update at most once every 5 minutes, eliminating redundant database writes on frequent API requests.
- Full-text host cooldowns: internal queue deferrals no longer place the entire publisher host on cooldown, preserving throughput for other queued items from the same host.

### Upgrade notes
- Migration `0039_performance_indexes.sql` adds composite indexes for cascade deletes, housekeeping, item pagination and full-text candidates, and configures monotonic sync state sequence floor triggers.

## [0.27.1] - 2026-10-16

### Fixed
- An author that a feed's next poll adds or changes now moves the item's content revision, so clients that already hold the item (and sync by revision) learn of it. Before, only items that a client fetched after the poll showed their author. Migration `0038_author_revision.sql` adds the trigger; the extraction status is untouched, so no full text is fetched again.
- The English forms of the byline, comment-rules and ad-label rules: `Posted by`, `Words by` and similar bylines, headings such as "Community guidelines" and "House rules", and labels such as "Ad", "Sponsored content" and "Paid content" are handled like their German counterparts.

### Upgrade notes
- Migration `0038_author_revision.sql` adds a trigger. After the update, the next poll of each feed moves the revision of the items that gain an author, so synced clients fetch those items once more; no full text is fetched again.

## [0.27.0] - 2026-10-16

### Added
- Authors: items carry the `author` their feed names (`dc:creator`, RSS `author`, Atom `author`), advertised as `item.author`. When there are several, all of them are listed, joined by commas. An address without a name (`staff@site.test`), a generic name (`admin`, `editorial staff`) and the publication's own name are left out; `staff@site.test (Anna Muster)` becomes `Anna Muster`. The API, the legacy item API and MCP return it, and the web reader shows it beside the date. Items get their author on the next poll of their feed; a poll that names none keeps a known one.

### Changed
- A byline in the article text that only repeats the feed's author (`by Anna Muster | 15.10.2026`) is left out of the reader's HTML, since clients now show the name beside the date.

### Fixed
- Product cards of shop links: a card whose picture is only a CSS background (which no reader draws) and that holds a link and a price (a label such as "Produkthinweis", the product name and its price) is left out of the reader as a whole, so no label stands over an empty space and no price of the day outlasts the article. The article's own links and its affiliate disclosure stay.
- Video players in the reader: the play-button picture of a player (alt text such as "Video starten" or "Abspielen", or a file named `play_icon.svg`) is a picture no reader can draw without the publisher's script, and showed up as a broken image. It is removed; a player that is only a script-driven button without an address is left out with its label. What has an address stays as one plain link to the video, marked `data-media="video"`: a player's two links to the same video become one, and embeds of YouTube, Vimeo and Dailymotion as well as `<video>` elements with a source turn into a link as well. Embeds of other sites are left as they were.
- Page chrome at the edges of an article: a byline that ends in the date (`by Anna Muster | 15.10.2026 - 11:41`) keeps the author and loses the date, which the reader shows in its head. A comment section's house rules at the end of the text ("Comment rules", "Comment policy") go with everything below them. An ad label such as "Advertisement" or "Sponsored" with no ad behind it, because a script fills the slot, is dropped; sponsored content itself and its label stay. German labels are handled the same way.

### Upgrade notes
- Migration `0037_item_author.sql` adds one nullable column to `items`; nothing needs to be done. Existing items show an author once their feed is polled again.

## [0.26.6] - 2026-10-16

### Changed
- `ipaddr.js` 2.5.0 in the address check for feed hosts. It reports more special-purpose ranges as non-public and parses short forms such as `127.1` as loopback; nothing that was blocked before is allowed now (#20).

### Fixed
- Structured data as article text: JSON-LD that a page framework renders as an element of any name (`<component type="application/ld+json">`), or that stands alone as a block, no longer shows up in the reader.
- A line that is only a date or a reading time (`15. Oktober 2026, 10:51 Uhr`, `2 min`, `4 min read`) near the start of an article is dropped from the reader, which shows both in its own head; the same lines further into the story stay. German and English month names are recognised.
- Badges in two colour schemes: a link that holds several images with the same label and no other text (a light and a dark variant that the publisher's stylesheet switches between) no longer shows all of them at full size in the reader. The link keeps its label as text, or its first image when it has none. The call to action itself stays.
- A feed's thumbnail as the hero picture: when the feed names a small size of a picture (for example `…__wide__148` or `…-720x405.jpg`) and the article shows the same picture in a clearly larger size, that size becomes the item's picture, up to 2000 px wide. It applies to new items and as soon as an article's full text is stored.

## [0.26.5] - 2026-10-15

### Added
- A reverse-proxy guide ([docs/reverse-proxy.md](docs/reverse-proxy.md)) for exposing FeedKeeper over HTTPS with Caddy, nginx or Traefik: hostname and `PUBLIC_URL`, HSTS, `TRUST_PROXY` for single and chained proxies, when `CLIENT_IP_HEADER` is needed (Cloudflare and hosts that overwrite `X-Forwarded-For`), nginx's request-body limit for OPML imports, and optional buffering settings for the stateless MCP endpoint. It is linked from the README and the Raspberry Pi guide. Thanks to @Aaqibhafeezkhan for writing it (#32).

## [0.26.4] - 2026-10-14

### Fixed
- Pictures that a publisher wraps in its own element (`<a-img src="…">` around an `<img>` that only holds a grey placeholder) are shown in the reader HTML: the wrapper's address replaces the placeholder and the wrapper is removed.

## [0.26.3] - 2026-10-14

### Changed
- The reader HTML also drops a standalone date and a short section link (up to three words) that stand before the first paragraph, as publishers repeat them from the page head.

## [0.26.2] - 2026-10-14

### Changed
- Curated editions remain readable between publications, including after their publication window expires. Edition reads and legacy ensure requests return the last curated issue; candidates remain available for producers to publish a new selection.
- The reader HTML no longer carries tracking and scripting attributes (`data-*` hooks, `aria-*`, `role`, `on*` handlers, microdata) or ids that nothing links to. Links keep `href`, `rel` (including `sponsored`) and `target`, images keep their lazy-load sources, and ids that an in-article link points to stay. Pages that put a long JSON blob on every link are a fraction of their size.

### Fixed
- The internal `content_lead` and `lead_version` columns are no longer part of the raw item output of the MCP tools and the web app's item list; the lead is served as `lead` by the native API.

### Upgrade notes
- The edition contract now serves curated publications only. Legacy `POST /edition/generate` and MCP `generate_edition` calls remain compatible reads and never publish a replacement, including with `force`. Producers publish through `publish_edition`; `edition.automatic` is no longer advertised. Migration 0036 retires active legacy automatic slots without changing existing curated issues.

## [0.26.1] - 2026-10-14

### Added
- Items carry a `lead`: the beginning of the article as one line of plain text, up to about 600 characters, without breadcrumbs, credits, calls to action and similar page chrome. It is advertised as the `item.lead` feature, derived when content is stored and refreshed when it changes, and comes from the downloaded text when there is one and from the cleaned feed summary otherwise. Clients can use it for teasers instead of deriving text from the HTML.

### Changed
- Article text is cleaned of page chrome that publisher pages put inside the body. The reader HTML (`contentHtml`, `fullTextHtml`) loses breadcrumbs, in-page jump links, a standalone date line, a headline repeated at the start, media labels, language switchers and consent placeholders of embedded posts; credits, disclosures, sponsored and affiliate content stay. Snippets, the text format of MCP `get_item` and the text used for edition curation also lose credit lines, tag lists, calls to action, advertising notices and recommendation tails, and snippets lose the footers that feed plugins append. Nothing is stored differently, so the rules apply to existing articles too. See `docs/full-text.md`.
- The reader HTML no longer carries typography: fonts, sizes, colours, alignment, classes and presentational tags are removed, so clients set the type themselves. Structure (headings, paragraphs, lists, quotes, tables, links, images) and emphasis (bold, italic, including emphasis that was only an inline style) are kept.

### Fixed
- Feeds that give an item only a `guid` that is a web address (no `link` element) now use it as the article address, so the full text can be fetched for such items. Existing items pick it up on the next poll.
- A feed that alternates between a full and a shortened variant of the same item no longer changes the stored content, and so its content revision, on every poll. The summary is kept together with the longer body it belongs to.

### Upgrade notes
- Migration 0035 adds two nullable columns to the items table. Leads of stored articles are derived in the background after the first start, in small batches, and are served derived on the spot until then.

## [0.26.0] - 2026-10-14

### Added
- Curated editions can carry a presentation plan (`layout`), published through `publish_edition` and advertised as the `edition.layout` feature. It names a character for the day (one topic dominates, a calm day, many short items) and blocks in reading order: lead, dossier (an overview topic with its stories), feature, standard, briefs, photo and quote. It says what matters and what belongs together; clients decide how to set it. The plan is validated against the issue, returned with the edition and in sync, and ignored by older clients. Issues without a plan are unchanged.

### Upgrade notes
- Migration 0034 adds a nullable column to the editions table and changes nothing else.

## [0.25.1] - 2026-10-13

### Changed
- The shortlist of edition candidates (`get_edition_candidates` and agents that curate an edition) gives every source its fair share instead of being filled with whatever is freshest. A source can take at most the shortlist size divided by the number of sources, rotated by what the last editions already showed, and quiet sources keep all their articles. A single source can still fill the whole list. The automatic edition is unchanged.

## [0.25.0] - 2026-10-13

### Changed
- On narrow screens the settings are a list of pages instead of a row of chips: each section shows its icon, name and description under its group heading, opens as its own page and has a back link. The side navigation on wide screens is unchanged. Sections added by a hosting product appear in the list automatically, and `shortLabel` is still accepted but no longer shown.

## [0.24.1] - 2026-10-13

### Fixed
- Opening FeedKeeper over plain `http://` (for example `http://localhost:3000` or an address in the home network) in Safari showed a blank page. The server now sends `upgrade-insecure-requests` and HSTS only when `PUBLIC_URL` is an `https://` address.

### Changed
- The connected clients under Settings → MCP are now called AI assistants instead of apps, so they are not confused with the FeedKeeper apps.
- The welcome card starts with its heading, and the short introduction card uses the same icons as the controls it describes.

## [0.24.0] - 2026-10-13

### Changed
- Full-text preparation continuously fills available workers. Reader requests and background work share article jobs, with configurable concurrency, host limits and bounded waiting.
- Normal proxied article images expire after at most six hours and support conditional requests. Archived images keep their fixed version.

### Fixed
- Broad relevance searches compute article rankings once, keeping the API responsive while feeds are updating.
- Slow sources and retry delays no longer hold up unrelated full-text jobs. HTTP 429/503 responses respect `Retry-After`, and interrupted jobs resume after shutdown.
- The web offline cache refreshes ordinary article images instead of keeping them indefinitely.

### Upgrade notes
- Migration 0033 extends the existing full-text queue. Run one process per database and stop the old process before upgrading. See [full-text fetching](docs/full-text.md) for settings and rollback.

## [0.23.1] - 2026-10-13

### Fixed
- Articles whose feed gave no readable publish date (a localised weekday name, "gestern", an empty value) were stored with that text. It sorted above every dated article, so they stayed at the top of the list, and they never aged. Articles with a placeholder date such as 1970-01-01 were removed by the age cleanup the night after they arrived. Both now use the time FeedKeeper stored the article, and a migration repairs entries that are already stored.
- Articles without a publish date no longer sort below every dated article in lists and search.
- Changing the password signs out every other browser. Access tokens, paired devices and connected apps keep working.
- Signing in with an address that has no account takes as long as a wrong password, so the response time no longer shows which addresses are registered.
- A search that mixes Latin words with Japanese, Cyrillic or Greek words only searched for the Latin ones. Every word has to match now.
- A malformed client id in the credentials of an OAuth token request is answered as an unknown client instead of a server error.

### Changed
- The documentation says that `SESSION_SECRET` also protects the two-factor keys and belongs with the backups.

## [0.23.0] - 2026-10-13

### Added
- A `feedkeeper` command that runs the server from npm: `npx feedkeeper`, or installed globally. It keeps the database, the archive and a generated session secret in one data folder (`~/.feedkeeper` by default) and takes `--port`, `--public-url` and `--data-dir`. `feedkeeper backup <file>` and `feedkeeper restore <file> --force` run the backup tool with the same settings. `npm run pack:npm` assembles the package.
- Without a configured `SESSION_SECRET`, the Docker image and the `feedkeeper` command create one on the first start and keep it in the data folder. A secret from the environment is never replaced.
- Templates for Unraid, CasaOS and Portainer in `deploy/`, described in [Running FeedKeeper on Unraid, CasaOS and Portainer](docs/deployment-homelab.md).
- Guides for [Raspberry Pi](docs/deployment-raspberry-pi.md) and for [Node.js without Docker](docs/deployment-npm.md), and an overview of all ways to run FeedKeeper in the README.

### Changed
- The Docker image starts through the `feedkeeper` command. The environment variables, the port and the data volume are unchanged.
- The README's Docker backup and restore commands use `feedkeeper backup` and `feedkeeper restore`, which also work when the secret was generated rather than configured.

### Fixed
- Restoring a backup from a location nothing can be written to, such as a single file mounted into a container, failed with "attempt to write a readonly database".

### Upgrade notes
- No database migration or configuration change is needed. Installations with a `SESSION_SECRET` keep using it. Pull the new image and restart.
- A container that overrides the image's command with `node server/dist/server.js` keeps working as before; only the default command changed.

## [0.22.1] - 2026-10-13

### Added
- Hosts can set the page title and description of the web app through `window.feedkeeperExtensions.meta`, by language like footer links. See [Extending the web app](docs/extending-the-web-app.md#page-title-and-description).

### Changed
- The README points to the hosted edition in its own short section instead of a banner above the screenshots.

### Upgrade notes
- No database migration or configuration change is needed. Without `meta` in `window.feedkeeperExtensions` the web app keeps its title and description.

## [0.22.0] - 2026-10-12

### Added
- Sign in with a passkey directly from the email field using browser autofill. Supporting browsers no longer show a separate passkey button; other WebAuthn browsers retain a text link.
- On-demand modal reauthentication dialog for protected security actions (passkey registration, passkey removal, authenticator setup/disable, and recovery code generation), allowing confirmation via passkey biometrics without typing a password.
- Feeds with active notifications display a visual bell icon directly in the feed list row.
- Structured onboarding welcome experience for accounts without feeds, featuring theme discovery starter packs, single website subscription, and OPML import.
- Support for custom `loginSubtitle` in public configuration.

### Changed
- Replaced emojis across the onboarding flow, starter pack categories, and view navigation with crisp inline SVG vector icons.
- Updated newspaper view toggle button icon in the articles page top bar to match the new newspaper vector icon.

### Fixed
- Reauth modal dialog is now mounted directly to the document body via a React portal, ensuring it is centered across the entire viewport with a full-screen backdrop.
- Security status and alert feedback messages are now formatted inside structured banners with proper card padding, theme-aware styling, and status icons.
- Relaxed rate limiting and security challenge attempt budgets (up to 15 attempts, 5-minute window) to prevent accidental lockouts.
- Display the welcome onboarding experience on the articles page when an account has 0 feeds regardless of route query filters, and automatically strip zombie `?folder=` / `?feed=` parameters.
- Passkey names and removal controls stay aligned on small screens; responsive forms stack properly on mobile.
- Authenticator setup is displayed as pending until the confirmation code is accepted; multilingual feedback in German, English, and Japanese.

### Upgrade notes
- No database migration or configuration change is needed. Existing passkeys and sessions continue to work seamlessly on the same HTTPS origin.

## [0.21.0] - 2026-10-11

### Changed
- Article lists select a page before loading full article content, reducing database work on larger libraries.
- Article images share a bounded disk cache and concurrent downloads within each feed. Missing images are cached briefly; saved articles reuse cached files while keeping their permanent copies.

### Upgrade notes
- No database migration or additional service is needed. The image cache defaults to 256 MiB next to the database; keep it separate from the archive and use one process per cache directory. See [Article images](README.md#article-images) for settings and rollback guidance.

## [0.20.0] - 2026-10-09

### Changed
- Feeds update in parallel with configurable limits for the server and each source. Scheduled and manual refreshes, subscriptions and OPML imports share the same queue; a slow feed no longer holds up the rest.
- Temporary failures retry with backoff, and sources' `Retry-After` requests are respected. Pending updates survive a restart.
- Push notifications run separately from feed updates and resume after a restart. Concurrent refreshes of the same feed share one fetch and do not send duplicate notifications.
- The web reader shows when a refresh is still pending, in English, German and Japanese.

### Added
- Polling settings and queue metrics. See [Feed polling](docs/feed-polling.md) for configuration and upgrade guidance.

### Upgrade notes
- Back up the database before updating; the two new migrations run automatically. Use one application process per database and allow 45 seconds for shutdown. The supplied Docker Compose file includes the new settings and shutdown grace period.

## [0.19.0] - 2026-10-09

### Added
- Passkeys for every installation: register and name multiple credentials in Settings → Account, sign in without a password, and remove credentials individually. WebAuthn checks the configured origin and requires device PIN or biometric verification.
- Optional two-factor authentication with an authenticator app (TOTP), QR/manual setup, ten single-use recovery codes and protected security settings. Password and OAuth sign-ins honor the second factor; a user-verified passkey can sign in on its own.
- Local operator recovery command `npm run security:recover -- --email reader@example.org --confirm` for a lost authenticator and recovery codes. It removes the factor and revokes access without changing the password or passkeys.
- [Account security guide](docs/account-security.md) covering HTTPS, stable domains, backups, recovery and the shared authentication API.

### Security
- Enabling or disabling TOTP revokes other browser sessions, device/API tokens, OAuth grants, pairing codes and pending sign-ins. The current browser stays open to save recovery codes. Security changes require fresh identity confirmation; API and read-only tokens cannot change factors.
- Authenticator secrets are encrypted; recovery codes and short-lived, purpose-bound challenge handles are hashed. Accepted authenticator codes and recovery codes cannot be reused.

### Upgrade notes
- Back up the database **and `SESSION_SECRET`** before updating. The secret also protects encrypted authenticator keys; rotating it requires authenticator recovery and re-enrollment. Migration `0029` runs automatically; existing accounts keep their current login until they opt in.
- Set `PUBLIC_URL` to the stable external HTTPS origin before enrolling passkeys. Localhost is supported for development; ordinary HTTP LAN addresses cannot use passkeys.

## [0.18.0] - 2026-10-08

### Added
- Extension point `articlesNotice`: a host can show one card above the list of articles, for example what a plan includes. It appears for accounts that already have feeds and only after the person has closed the short tour, so one card is shown at a time. `applies(user)` decides whether it is still to be shown; closing it is up to the host's content.
- An account whose plan does not include the `sync` feature (a hosted service after the trial) can no longer add, import or update feeds: the API answers `403 capability_not_available` (with `manageUrl`) for adding a feed, discovering feeds, importing OPML, refreshing one or all feeds and creating a folder. Reading, exporting and deleting stay available. The web app switches off the buttons for these actions (add, import, refresh, pull to refresh, new folder), explains why in a notice on the articles and feeds pages (and instead of the welcome card for an account without feeds) and links to the plan when the server says where it can be changed. Self-hosted instances send no limits and are not affected.

### Changed
- The poller does not fetch a feed that only accounts without the `sync` feature subscribe to; a feed that anyone with it subscribes to is fetched as before.

## [0.17.0] - 2026-10-08

### Added
- A welcome card for a person without feeds, on the articles page and on the feeds page: add a website by its address, pick a starter pack (news, technology, Apple, science, design; the feeds in the language of the app first, Japanese readers get Japanese feeds only) or import an OPML file. A pack subscribes its feeds into a folder with the pack's name.
- A short introduction ("A short tour") on the articles page: the list and newspaper views, the unread filter, the star for saving, and folders. Every account sees it once, existing accounts included, as soon as it has feeds; closing it is stored with the account (`POST /api/auth/me/intro`, `intro_dismissed_at` on the user, migration `0028`), so it stays closed on every device.
- Extension point `passwordCard`: a host that signs people in another way (single sign-on, Sign in with Apple) can replace the password card of the account page, for everyone or, with `applies`, for the users who have no password.
- Extension points `starterPacks` and `onboarding` let a host add packs, replace the list, and show its own content above the first steps.
- Footer links can carry a small `icon` and be limited to some `placements` (`login`, `menu`, `page`), so a host no longer needs style rules to decorate or hide them.

### Changed
- The articles page tells the empty cases apart: no feeds (welcome card), feeds that have not been fetched yet (a waiting message that updates itself), everything read ("All caught up" with a button to show all), no search result, and a load error with a retry button.
- The language is only stored when the person picks one (cookie `fk_lang` and local storage); without a choice the app follows the system's language. Until now the language the browser reported was stored as if it had been chosen. A choice made on another page of the same site, such as the landing page of a hosted service, applies in the app too.
- When the language changes, host scripts are told to read their settings sections and footer links again, and the content they put into the page (settings sections, sign-in form, password card, welcome content) is built again in the new language.
- The "Add feed" button on the feeds page no longer appears twice while there are no feeds.

### Fixed
- Titles of feeds and articles with line breaks or runs of spaces (for example "A List Apart: The Full Feed" with a leading line break) are cleaned up when they are fetched and shown as one line, which also fixes odd spacing in the unsubscribe dialog.
- The "Follow system" label of the Japanese theme switch was so long that it wrapped over three lines; it now reads "システム".

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

[Unreleased]: https://github.com/visualfusion/feedkeeper/compare/v0.28.4...HEAD
[0.28.4]: https://github.com/visualfusion/feedkeeper/compare/v0.28.3...v0.28.4
[0.28.3]: https://github.com/visualfusion/feedkeeper/compare/v0.28.2...v0.28.3
[0.28.2]: https://github.com/visualfusion/feedkeeper/compare/v0.28.1...v0.28.2
[0.28.1]: https://github.com/visualfusion/feedkeeper/compare/v0.28.0...v0.28.1
[0.28.0]: https://github.com/visualfusion/feedkeeper/compare/v0.27.2...v0.28.0
[0.27.2]: https://github.com/visualfusion/feedkeeper/compare/v0.27.1...v0.27.2
[0.27.1]: https://github.com/visualfusion/feedkeeper/compare/v0.27.0...v0.27.1
[0.27.0]: https://github.com/visualfusion/feedkeeper/compare/v0.26.6...v0.27.0
[0.26.6]: https://github.com/visualfusion/feedkeeper/compare/v0.26.5...v0.26.6
[0.26.5]: https://github.com/visualfusion/feedkeeper/compare/v0.26.4...v0.26.5
[0.26.4]: https://github.com/visualfusion/feedkeeper/compare/v0.26.3...v0.26.4
[0.26.3]: https://github.com/visualfusion/feedkeeper/compare/v0.26.2...v0.26.3
[0.26.2]: https://github.com/visualfusion/feedkeeper/compare/v0.26.1...v0.26.2
[0.26.1]: https://github.com/visualfusion/feedkeeper/compare/v0.26.0...v0.26.1
[0.26.0]: https://github.com/visualfusion/feedkeeper/compare/v0.25.1...v0.26.0
[0.25.1]: https://github.com/visualfusion/feedkeeper/compare/v0.25.0...v0.25.1
[0.25.0]: https://github.com/visualfusion/feedkeeper/compare/v0.24.1...v0.25.0
[0.24.1]: https://github.com/visualfusion/feedkeeper/compare/v0.24.0...v0.24.1
[0.24.0]: https://github.com/visualfusion/feedkeeper/compare/v0.23.1...v0.24.0
[0.23.1]: https://github.com/visualfusion/feedkeeper/compare/v0.23.0...v0.23.1
[0.23.0]: https://github.com/visualfusion/feedkeeper/compare/v0.22.1...v0.23.0
[0.22.1]: https://github.com/visualfusion/feedkeeper/compare/v0.22.0...v0.22.1
[0.21.0]: https://github.com/visualfusion/feedkeeper/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/visualfusion/feedkeeper/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/visualfusion/feedkeeper/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/visualfusion/feedkeeper/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/visualfusion/feedkeeper/compare/v0.16.2...v0.17.0
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
