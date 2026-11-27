# Article image cache

The image proxy shares downloads and cached images between subscribers of the same feed. This covers native clients requesting proxy images and the web app's offline copies; images loaded directly from a publisher bypass this cache. Every request checks access to the article and its image. Different feeds and different source URLs, including query parameters, have separate cache entries.

## Defaults and settings

The disposable cache defaults to **256 MiB, 2,000 images and six hours**, with four active jobs and at most 32 waiting jobs. Full queues return `503 image_busy` with `Retry-After: 1`. Downloads retain the existing HTTP limits, size limit, SSRF checks and redirect rules; `POLL_REQUEST_TIMEOUT_MS` also bounds time spent waiting in the image queue. Missing images (HTTP 404/410) and unsupported formats are remembered for 60 seconds; other failures are not cached. Source cache directives can shorten or prevent disk caching.

See `IMAGE_CACHE_*` in [`.env.example`](../.env.example) to change these limits. `IMAGE_CACHE_PATH` defaults to `image-cache` next to the database. Use one process per cache directory and keep it separate from `ARCHIVE_PATH`. Expired and least recently used entries are removed automatically. The cache stores hashed keys rather than source URLs, uses asynchronous file operations, and does not write to SQLite on cache hits. Once used, it logs aggregate `image_cache` counters every minute: hits, misses, shared work, negative hits, errors, overloads, evictions, bytes, entries, active and waiting jobs.

## Offline isolation and lifetimes

The web reader binds offline article snapshots and queued changes to the authenticated account. Account switches invalidate private service-worker responses, including when the previous session expired without an explicit logout; in-flight responses cannot refill a later session's cache. Legacy snapshots without account ownership are discarded and downloaded again. A change in another tab revokes that tab's offline account binding until authentication is refreshed.

Normal proxied article images use private cache lifetimes of at most six hours and a content ETag. Browsers and the web offline cache revalidate them; archived images keep their fixed version.

## Saved archives and rollback

Saved articles retain their permanent archives. Cache and archive files share disk space through hard links when they are on the same filesystem; otherwise saving an article copies its image. Evicting the cache never deletes a saved copy. Existing archives can refill the cache without contacting the source; these snapshots stay tied to their article so an old saved image cannot replace a newer one at the same source URL. Back up the database and archive as before; the disposable cache needs no backup.

No database migration is needed. To roll back, stop the application and return to the previous version. Alternatively, set `IMAGE_CACHE_MAX_BYTES=0` and restart to disable disk caching; `IMAGE_CACHE_NEGATIVE_TTL_SECONDS=0` also disables remembered failures. Existing disposable files can be removed while the application is stopped. Keep the archive.
