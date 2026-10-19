# Shared editions and native reading preferences

Status: base contract implemented in FeedKeeper `0.11.0`; linked overviews and explicit article limits are additive, unreleased extensions. The HTTP schemas are in [../openapi.yaml](../openapi.yaml); the wider native API is described in [native-api.md](native-api.md).

## Responsibilities and priority

The server retains the latest curated issue for each user. An external agent uses MCP to inspect candidates, read original articles and publish a curated issue. Native apps display the ordered issue and cache it for offline reading.

1. A published issue stays readable until a newer curated issue replaces it or the user explicitly dismisses it.
2. Expiry indicates when the next publication is due; it does not take the previous issue away from readers.
3. The server never creates a heuristic replacement, including when preferences change or a time boundary passes.
4. An offline app keeps its last cached issue. A failed connection is not a dismissal or proof that no issue exists.

The web reader does not use these issues or native preferences. Its category ordering and article filters remain unchanged.

## Native preferences

Feature flag: `native-preferences`. `GET /api/v1/native-preferences` returns defaults with revision 0 until a user writes preferences. GET has no side effects.

| Field | Default | Meaning |
|---|---|---|
| `timeZone` | `UTC` | Shared IANA time zone for issue boundaries. Apps adopt the user's current zone once or change it explicitly; devices must not overwrite it on every launch. |
| `editionSize` | `24` | Maximum articles, from 1 to 24. Producers may choose their own default while `editionSizeIsCustom` is false. |
| `editionSizeIsCustom` | `false` | Read-only marker for an explicit personal limit. A folder-only preference write never sets it. |
| `readingMinutes` | `null` | Optional approximate reading budget, from 5 to 180 minutes. An issue may include a single article longer than the budget. |
| `folderOrder` | `[]` | Ordered stable folder IDs for app sidebars and section controls. `null` may appear once for the unfiled section. Unlisted folders append in the order returned by `GET /folders`. |
| `hiddenFolderIds` | `[]` | Folders excluded from the newspaper, including candidate shortlists and new MCP publications. The ordinary article library stays available. |
| `preferredFolderIds` | `[]` | A modest selection boost. Hidden folders remain excluded even if preferred. |
| `showUnfiled` | `true` | Include subscribed feeds without a folder in the newspaper. |

`PATCH /native-preferences` merges only supplied fields. With `native-preferences.edition-size`, an integer `editionSize` sets `editionSizeIsCustom: true`, including an explicit 24; null resets it to false with the core fallback 24. Omission preserves the marker. `readingMinutes: null` removes the time budget. On older stored preferences, non-24 values are treated as explicit; legacy 24 is treated as an implicit default because historical folder-only writes stored 24 too. A user who deliberately chose 24 can select it again to retain that intent. Arrays replace their complete field. It requires `expectedRevision` and a UUID `requestId`; duplicate IDs, foreign folders, invalid zones and unknown fields are rejected. A successful first write records revision 1 even when it only adopts defaults. Later writes which change nothing retain the revision.

```json
{
  "requestId": "d3b258ec-5bc7-487c-9bca-e685c2b84d61",
  "expectedRevision": 0,
  "timeZone": "Europe/Berlin",
  "folderOrder": [12, 4, null, 9],
  "hiddenFolderIds": [9],
  "showUnfiled": true
}
```

The response is the full preference object with `revision` and `updatedAt`. Concurrent changes return HTTP 409 `{ "error": "revision_conflict", "current": { ... } }`. Keep the local draft, compare it to `current`, and merge or ask the user. A revised operation gets a new request ID and the current revision.

All folder IDs are scoped to the current account. Renames retain preferences. Deletion through native API, web API or MCP prunes the ID atomically from all three arrays, increments the preference revision and emits a sync change. A new folder with the same name gets its own identity.

### Adopting existing app settings

The app resolves its existing section names against stable IDs from `GET /folders` and sends its saved order and exclusions only when the shared preference revision is 0. Use a persisted request ID for the first upload. If another device has already initialized the settings, use the server version and retain any conflicting local intent for review; do not overwrite the shared settings on every device's first launch. Producers read the shared preferences before choosing an issue so the published selection observes the user's choices.

The server cannot read a device's current local settings itself. This contract prepares that transfer; apps still need to implement it. Presentation preferences apply immediately in app sidebars and section visibility. Selection settings affect the next issue; changing preferences does not silently rewrite an issue being read. `preferencesRevision` records which settings produced it.

## Candidate shortlists

Candidate ranking helps a curator inspect a bounded selection. It does not publish an edition.

- Eligible candidates are unread, currently subscribed articles from the last seven days. An absent or invalid publication date falls back to the stored date. Future-dated articles are not selected early.
- Muted keywords and hidden native sections are excluded. These exclusions affect the newspaper; native preferences never filter the web reader.
- Candidate gathering takes up to 40 articles per source, ordered by date, and at most 4000 total. This keeps a busy source from occupying the entire candidate pool.
- The base score decays with an 18-hour half-life and gives preferred folders a factor of 1.4. Photos and unsynchronized device opening counters do not influence selection.
- During selection, additional stories from the same source or folder receive diminishing weight. Initial caps favour diversity; caps relax to fill a small library without inventing stories.
- Canonical URLs remove known tracking parameters while preserving meaningful query parameters. Long identical titles and very similar word sets suppress likely duplicates. This is conservative text matching, not semantic event grouping.
- Stories offered in the retained history within 72 hours are considered after new candidates. The last 32 issues per user are kept; old original articles are not copied into the history.
- Reading estimates use cached content length. The optional budget is approximate; no external fetching or model call is needed to inspect the shortlist.

The first selected article is the lead. Clients preserve the server's order; they can adapt columns and card sizes to each screen. Rich thematic grouping, semantic comparison and learning from cross-device reading habits are future work.

## Identity, time slots and replacement

Feature flag: `edition.revisions`.

Every published issue gets an opaque `id`, its own `createdAt`, `source: curated`, `period`, `expiresAt`, optional `title` and `summary`, `preferencesRevision` and ordered `itemIds`. The slot's `revision` increases on publication and explicit dismissal. Titles must use the displayed issue's `period`, not the device's current time.

`GET /edition` returns the latest non-dismissed curated publication, including its ordered articles, even after `expiresAt`. `GET /edition/state` returns the scheduling state `{ revision, status, edition }`: `none`, `active`, `expired` or `dismissed`. Expired scheduling state has `edition: null`, while `GET /edition` still returns the publication for reading. Producers use scheduling state to decide when the next publication is due.

Time slots follow the shared zone: morning starts at 05:00, midday at 11:00, evening at 17:00 and late at 23:00. The late period spans midnight. Boundaries account for daylight saving and fractional UTC offsets.

Reading, refreshing feeds and changing preferences never publish an issue. The deprecated `POST /edition/generate` and MCP `generate_edition` requests remain as read-only compatibility aliases: they return the latest curated issue, or absence. `force` never creates a replacement. A supplied `expectedRevision` still detects conflicts. New publications use `publish_edition` with a revision and stable request ID.

`DELETE /edition` explicitly dismisses the issue and advances the retained revision. Only a producer can publish its successor. Expiry alone performs no write and does not advance the revision. A separate hourly task prunes completed native request receipts after at least 35 days; it never selects articles.

Migration `0036_curated_only_editions.sql` retires still-active legacy automatic slots as expired and preserves their revision watermark. Existing curated publications stay untouched; historical issues are not reconstructed or republished.

## MCP curation

Read tools:

- `get_native_preferences`: the same shared preferences as the native API.
- `get_edition`: current state and revision, including absence or dismissal.
- `get_edition_candidates`: compact bounded candidates, current state and preferences. Follow up with `get_item` when the original text matters.

Write tools:

- `update_native_preferences`: the same conditional PATCH contract.
- `generate_edition`: legacy read-only alias for the latest curated publication.
- `dismiss_edition`: conditional dismissal.
- `publish_edition`: publish 1–24 ordered, unique, accessible IDs with optional editorial text. It may deliberately include read, saved or annotated articles; subscribed hidden sections and muted items are rejected.

Recommended agent flow: read preferences and candidates, inspect selected originals, then publish with the observed `expectedRevision` and a persisted UUID `requestId`. On a conflict, reread and reconsider the selection before sending a new operation. The server remains the authority and never needs to run the agent itself.

`publish_edition` defaults to 24 hours. Supply either `durationHours` (positive, at most 168) or a future ISO `expiresAt` within seven days, never both. Expiry never replaces a publication with a heuristic selection. Optional `title` (up to 200 characters) and `summary` (up to 2000) are editorial plain text, not replacement article content. Treat agent text and article content as untrusted input when rendering them or supplying them to another agent.

## Sync, receipts and offline copies

`/sync` delivers `native_preferences` with ID 1 and the complete settings, and `edition` with ID 1 and issue metadata. The metadata's string `id` is the issue identity; the outer numeric ID 1 identifies the user's singleton slot. Edition deletion data contains the retained `revision` and `status`. A first sync includes existing preferences and editions. Clients ignore unknown entities so older apps keep syncing notes, folders and item state.

Completed preference and edition commands store their result atomically with the write, including publication and dismissal results. A replay with the same request ID and payload returns the original metadata result, even if the account has moved on. Reusing an ID for another operation or payload returns `request_id_reused` (409). Receipts last at least 35 days; older replays need fresh state and a new operation. Validation failures and revision conflicts do not consume a request ID. Article objects hydrated for an HTTP response still reflect current article content and state; a `no_edition` response includes the current slot state so a client can recover from a late replay.

Apps retain offline drafts until acknowledgment. Apply monotonic revisions when a delayed response arrives, preserving newer local edits and queued changes. Keep cached issue articles, text and media offline. `limits.retention.protectActiveEdition` instructs clients to preserve active issue IDs alongside saved, annotated and unsynchronized articles. Server cleanup and unsubscribe paths apply the same protection, with access scoped to the issue's owner until expiry or dismissal.

A fresh 404 and an offline failure have different meanings. An expired cached issue may remain readable as a previous issue while the app waits for a replacement. When a new revision arrives during reading, offer the new issue without closing the reader or moving stories beneath the user. The API supplies the state; this presentation behaviour is implemented by clients.

## Upgrade and test deployment

Migration `0023_server_editions.sql` is additive: it introduces preferences, receipts and history and extends the existing edition slot. Existing curated issues retain their IDs, order, timestamps and revision; they receive an opaque issue identity. Legacy issues without an expiry receive a 24-hour expiry at migration time. Existing explicit expiries are retained. Notes, tokens and subscriptions are preserved.

Back up the database and article archive before deploying. Build and test before restart; startup applies the migration and starts edition maintenance. Deploy a tagged release with matching package versions and built assets. For an unpublished preview, use a distinct development version and keep its changes under Unreleased until publication is authorized.

## Linked overviews (unreleased)

Feature flag: `edition.overview`. `publish_edition` accepts optional `overview`, an array of 1–5 `{heading, segments}` blocks. Each segment has plain `text` and an optional positive integer `itemId`. The server requires at least one linked segment per block, validates every reference against the selected and access-checked `itemIds`, and rejects invalid links with `invalid_overview_reference`. Headings are limited to 160 UTF-16 code units, segments to 1000, at most 20 segments per block and 3000 visible code units in total. The server assigns stable per-issue IDs (`topic-1`, etc.). Native responses and sync include the stored overview. Older clients ignore it and display `summary`; when no summary is supplied, a plain-text fallback is derived from the blocks.

```json
{
  "itemIds": [123, 456],
  "expectedRevision": 7,
  "requestId": "d3b258ec-5bc7-487c-9bca-e685c2b84d61",
  "overview": [{
    "heading": "City plans three libraries",
    "segments": [{"text": "According to "}, {"text": "Local News", "itemId": 123}, {"text": ", the city plans three libraries in May."}]
  }]
}
```

Clients concatenate segments, create native article links from validated IDs, and never open URLs supplied by the producer. A link may only open a cached article from the displayed issue of the active account. Changing issues keeps the existing reader and offline retention behavior. Reference validation proves identity/access, not the truth of a producer's prose. Producers remain responsible for grounding claims in the originals.

Candidate payloads additionally include `sourceName` and `folderName`. The generic internal helper `cachedEditionSources(userId, itemIds)` provides access-checked cached reader/feed/snippet text, with no network fetching or scripts. It permits at most 24 distinct IDs, at most 6000 characters per article and 48000 total (UTF-16 units); it indicates `textKind` and may truncate source material. This is an internal extension point, not a new public full-text endpoint.

Migration `0025_edition_overview.sql` adds a nullable JSON column without changing existing editions, accounts or tokens. Consumers must build the current core before validation; core builds now emit declarations so downstream TypeScript contracts cannot silently use stale declaration files.


## Layouts (unreleased)

Feature flag: `edition.layout`. `publish_edition` accepts an optional `layout`, a presentation plan for the issue: what its writer considers important and what belongs together. It never says how a screen draws it; clients map the roles onto their own columns, sizes and type. The issue's `itemIds` stay the canonical, ordered list, and an issue without a layout is shown exactly as before.

```json
"layout": {
  "version": 1,
  "character": "dominant",
  "blocks": [
    { "type": "lead", "itemId": 101, "kicker": "Aviation" },
    { "type": "dossier", "topic": 1, "itemIds": [102, 103] },
    { "type": "feature", "itemId": 104 },
    { "type": "standard", "stories": [{ "itemId": 105 }, { "itemId": 106 }] },
    { "type": "photo", "itemId": 107 },
    { "type": "briefs", "itemIds": [108, 109, 110] }
  ]
}
```

`character` is `dominant` (one topic carries the day), `calm` (room for pictures) or `briefing` (many short items). Block types:

| `type` | Fields | Meaning |
|---|---|---|
| `lead` | `itemId`, `kicker?` | The story of the day. At most once, and only as the first block. |
| `dossier` | `topic`, `itemIds` (1–4) | One topic of `overview` (1-based position) with the stories it is about. One dossier per topic. |
| `feature` | `itemId`, `kicker?` | A strong single story, larger than the rest. |
| `standard` | `stories` (1–3 × `itemId`, `kicker?`) | Ordinary stories side by side. |
| `briefs` | `itemIds` (2–8), `title?` | Short items without large pictures. |
| `photo` | `itemId` | One picture set large; meaningful only for a story with an image. |
| `quote` | `itemId`, `text` (≤ 160) | A statement of an article set large. The issuer vouches that it is quoted from the article; the server checks form and length only. |

A `kicker` is one short phrase of at most 40 characters without closing punctuation: a classification, not a statement. Validation is strict: unknown fields and block types, a version other than 1 and malformed values are rejected with `invalid_layout`. A layout that names a story outside the issue, or a topic that the overview does not have, is rejected with `invalid_layout_reference`; a story used twice, a lead that is not first and a second dossier for one topic are `invalid_layout`. At most 24 blocks. Stories the layout does not mention remain part of the issue; clients set them as plain stories after the planned blocks, in the order of `itemIds`.

Clients must tolerate `null`, versions they do not know and block types they do not know (set their stories as plain ones), and must not depend on a layout being present. Migration `0034_edition_layout.sql` adds a nullable JSON column and leaves existing editions untouched.
