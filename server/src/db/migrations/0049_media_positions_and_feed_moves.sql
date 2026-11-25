CREATE TABLE IF NOT EXISTS item_media_positions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position_seconds INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_item_media_positions_user_updated ON item_media_positions(user_id, updated_at);

ALTER TABLE feeds ADD COLUMN suggested_url TEXT;
ALTER TABLE feeds ADD COLUMN suggested_url_checked_at TEXT;
