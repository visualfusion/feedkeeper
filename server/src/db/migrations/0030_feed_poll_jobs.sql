-- One application process owns polling. Pending work is durable; running locks are memory-only.
CREATE TABLE feed_poll_jobs (
  feed_id INTEGER PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL,
  available_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_feed_poll_jobs_due ON feed_poll_jobs(available_at, enqueued_at, feed_id);
CREATE INDEX idx_feed_poll_jobs_host ON feed_poll_jobs(host);
CREATE TABLE feed_poll_hosts (
  host TEXT PRIMARY KEY,
  retry_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_feed_poll_jobs_fifo ON feed_poll_jobs(enqueued_at, feed_id);
