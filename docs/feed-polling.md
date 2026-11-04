# Feed polling

FeedKeeper checks several feeds at once, so a slow source does not hold up the rest. Scheduled updates, manual refreshes, new subscriptions and OPML imports use the same queue. Requests for the same feed share one fetch. Adding many feeds at once (`POST /api/v1/subscriptions/batch`, OPML import) only stores them and queues their first fetch, so it returns at once and the queue works through them in the background.

Waiting work stays in SQLite and resumes after a restart. Run **one application process per database**: the concurrency limits and duplicate protection are local to that process. Multiple workers or replicas sharing a database are not supported.

## Settings

Defaults suit a small installation. Set these variables in `.env`; the supplied Docker Compose file passes them to the container. Other launch methods need to pass them explicitly. Values must be integers; invalid settings stop startup.

| Variable | Default | Purpose |
|---|---:|---|
| `POLL_CONCURRENCY` | 4 | Maximum active feed attempts and simultaneous downloads, each counted separately |
| `POLL_HOST_CONCURRENCY` | 2 | Maximum concurrent attempts or downloads per hostname |
| `POLL_MAX_WAITERS` | 64 | Limit for waiting API calls, downloads and icon tasks, each counted separately |
| `POLL_REQUEST_TIMEOUT_MS` | 15000 | Total time for a download from its first slot, including DNS, redirects and body; waiting for a slot is limited by the attempt timeout |
| `POLL_ATTEMPT_TIMEOUT_MS` | 30000 | Time for a feed attempt; also the maximum API queue wait and the time limit of an icon check |
| `POLL_MAX_RETRIES` | 2 | Extra attempts after a temporary failure |
| `POLL_RETRY_BASE_MS` | 5000 | Initial retry delay, increased with each failure and randomized |
| `POLL_RETRY_MAX_MS` | 300000 | Maximum retry delay, except when a source asks for longer |
| `POLL_TICK_MS` | 1000 | How often to check for delayed work; free slots refill immediately |

On a host with little memory, start with concurrency 2, host concurrency 1 and 32 waiters. On larger hosts, start with the defaults. Try 8 concurrent feeds only after checking memory, queue delay and API response times. Parsing, SQLite writes, full-text extraction and image archiving still need headroom.

Keep the request timeout within the attempt timeout. The request timeout starts when a download gets its place in the shared limit, so a busy server does not use it up while the download waits. `MIN_POLL_INTERVAL_MINUTES` still controls the shortest feed interval. Raising the global limit need not raise the host limit.

## Refreshes and retries

Feeds someone is waiting for, such as a new subscription or a manual refresh, run first; after that the oldest eligible jobs run, skipping busy or paused hosts. Downloads follow the same rule: discovery and the first fetch of a feed that is being subscribed go ahead of scheduled polls and icons, and when the waiting list is full they take the place of the newest background download. Discovery, redirects and icons share the download limits. Each hostname has its own limit, regardless of scheme or port; subdomains count separately.

A feed's icon check runs after its poll has returned: it no longer holds the poll slot or delays the answer to a new subscription, has its own time limit and cannot fail or retry the poll. Its downloads count as background work in the shared limits.

Temporary failures get limited retries with increasing, randomized delays. Other failures wait for the regular interval. HTTP 429/503 pause requests to that host; a valid `Retry-After` can extend the pause beyond the retry maximum. Pauses survive restarts, release workers and cannot be bypassed by manual refresh.

Manual refresh joins existing work. If it cannot finish in time, the API returns `deferred: true` and optionally `retryAt` (Unix milliseconds); bulk refresh returns a deferred count. Work continues in the background. Clients should use normal sync to observe the result. The web reader shows a pending notice.

ETag, Last-Modified, 304 handling and SSRF checks remain in place. Push notifications have their own persistent queue; duplicate refreshes and 304s create no extra notifications. A hard crash just after a push provider accepts a notification can repeat that delivery on restart.

## Logs

Every minute, `feed_poll_metrics` logs queue size, active work, throughput, fetch duration, errors, retries and throttling. `oldestMs` shows queue age; `meanStartLagMs` and `maxStartLagMs` show how late feeds start. The nested `push` fields show notification backlog, deliveries and drops.

Counters are cumulative. Delayed retries count as pending, so the queue need not reach zero. Watch for growing delays, push drops, high memory use and slower API responses. Logs omit URLs, hostnames, account details and content.

## Updating and rolling back

1. [Back up the database](../README.md#back-up-and-restore), keep the previous application and configuration, and test the update before production.
2. Stop the old process first. Migrations add the queue tables automatically. Allow **45 seconds** for shutdown, as Docker Compose and the [supervisord example](deployment-uberspace.md) do. Integrations should use `installPollingShutdown` too.
3. Start conservatively and watch several polling intervals before raising limits. Unfinished updates and notifications resume after a restart.

To reduce load, set both concurrency limits to 1 first. For a code rollback, stop the process and restore the previous application and configuration, including any wrapper. The added tables can stay, but older code ignores saved jobs, host pauses and pending notifications. Drain notifications and wait out source pauses before reverting where possible. A normal rollback needs no database restore.
