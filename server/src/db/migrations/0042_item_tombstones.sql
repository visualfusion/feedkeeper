-- Articles removed by retention while their feed still lists them. Without this record the next poll
-- would add them again as new, unread articles (and announce them by push), every day.
CREATE TABLE IF NOT EXISTS item_tombstones (
  feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (feed_id, guid)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_item_tombstones_last_seen ON item_tombstones(last_seen_at);
