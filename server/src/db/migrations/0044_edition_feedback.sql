-- Reader feedback (up/down votes) on curated edition articles for future edition personalization.
CREATE TABLE IF NOT EXISTS edition_feedback (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  vote INTEGER NOT NULL CHECK (vote IN (-1, 1)),
  keywords_json TEXT NOT NULL CHECK (json_valid(keywords_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_edition_feedback_user_updated ON edition_feedback(user_id, updated_at DESC);
