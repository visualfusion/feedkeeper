# Building a client for FeedKeeper

FeedKeeper provides an open REST API (`/api/v1`) designed for offline-first reading apps, desktop tools, and custom integrations. This guide covers the basics of connecting a client.

For the full endpoint reference with input schemas and responses, see [docs/openapi.yaml](openapi.yaml).

## 1. Authentication & pairing

Clients authenticate using a Bearer token in the `Authorization` header:

- **Personal access tokens**: Users can generate a token in **Settings > API & integrations**. Good for scripts and command-line tools.
- **Device pairing with a QR code**: Best for interactive mobile and desktop apps.
  1. The user opens **Settings > Devices** in the web app and clicks *Pair new device*.
  2. The web UI displays a QR code containing `{ "url": "https://...", "code": "..." }`.
  3. Your app calls `POST /api/v1/devices/pair` with `{ "code": "...", "deviceName": "My Reader", "platform": "ios" }`.
  4. The server returns a long-lived device token scoped specifically to `/api/v1`. Users can see and revoke connected devices in their settings at any time.

## 2. Server capabilities

On first launch or network reconnect, call `GET /api/v1/meta`. The response tells you:
- `features`: Supported features on this server (such as `sync`, `notes`, `edition`, `search.fts`, `feed-icons`, `folder-icons`).
- `limits.retention`: Housekeeping rules (retention age for read items, maximum age, item cap per feed). Offline clients can use these limits to mirror server housekeeping locally.

## 3. Incremental synchronization

FeedKeeper uses a compact change log so offline clients stay in step without downloading entire libraries again:

1. **Pull changes (`GET /api/v1/sync?since=<seq>`)**:
   - Returns an array of changes recorded since the given sequence number (`upTo`).
   - Changes cover subscriptions, folders, muted keywords, article read/saved states, notes, and curated editions.
   - If `hasMore` is true, continue polling until you reach the current sequence.
2. **Push offline changes (`POST /api/v1/mutations`)**:
   - Send batches of up to 200 local actions made while disconnected (`item.read`, `item.save`, `item.progress`, `item.note.set`, `item.note.delete`).
   - Each mutation takes a unique UUID `requestId` so repeats are safe.
   - Note operations accept an optional `expectedRevision` to catch edits made on another device while offline.

## 4. Reading and article content

- **Overview and list**: `GET /api/v1/items` provides cursor-paged articles with titles, snippets, publication dates, and feed metadata.
- **Article text**: Call `GET /api/v1/items/{id}/reader` to get cleaned article content parsed on the server with Readability. Sites with cookie walls or paywalls are handled and remembered per feed.
- **Images**: Images referenced in cached articles can be loaded through `GET /api/v1/items/{id}/images/{hash}` so the client never hits third-party trackers directly.
- **Feed icons**: `GET /api/v1/subscriptions/{id}/icon` returns icons cached on the server, with conditional `ETag` and `If-None-Match` support.

## 5. Notes, search & editions

- **Article notes**: `GET`, `PUT`, and `DELETE` on `/api/v1/items/{id}/note` let users save personal Markdown notes on any story. Articles with notes are permanently excluded from server retention cleanup.
- **Full-text search**: `GET /api/v1/search?q=...` uses SQLite FTS5 with BM25 relevance ranking across titles, snippets, cached full text, and personal notes.
- **Editions**: `GET /api/v1/edition` serves the latest curated issue of up to 24 stories, published via MCP.

## 6. Account capabilities

Clients can inspect active features and account details via `GET /api/v1/me`. The response includes a `capabilities` object:

```json
{
  "id": 1,
  "email": "reader@example.com",
  "displayName": "Reader",
  "role": "user",
  "scope": "write",
  "deviceId": 42,
  "capabilities": {
    "type": "selfhosted",
    "features": {
      "mcp": true,
      "sync": true,
      "notes": true,
      "editions": true,
      "fulltext": true
    },
    "manageUrl": null
  }
}
```

- **`type`**: Indicates the server deployment model (defaults to `"selfhosted"`).
- **`features`**: Map of active features on the account. Self-hosted instances have all features enabled.
- **`manageUrl`**: Optional URL to external account administration (if configured by the host).
