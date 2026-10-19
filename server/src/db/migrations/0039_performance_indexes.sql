-- Foreign key and cascade delete indexes
CREATE INDEX IF NOT EXISTS idx_item_reads_item ON item_reads(item_id);
CREATE INDEX IF NOT EXISTS idx_item_progress_item ON item_progress(item_id);
CREATE INDEX IF NOT EXISTS idx_item_note_revisions_item ON item_note_revisions(item_id);
CREATE INDEX IF NOT EXISTS idx_full_text_jobs_user ON full_text_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_user ON oauth_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_client ON oauth_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_security_challenges_user ON security_challenges(user_id);

-- Housekeeping and retention cleanup indexes
CREATE INDEX IF NOT EXISTS idx_native_requests_created ON native_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_applied_mutations_applied ON applied_mutations(applied_at);
CREATE INDEX IF NOT EXISTS idx_items_feed_eff_pub ON items(
  feed_id,
  COALESCE(julianday(published_at), julianday(created_at)) DESC,
  id DESC
);

-- Item listing, cursor pagination, lead backfill, and full-text candidate indexes
CREATE INDEX IF NOT EXISTS idx_items_feed_created ON items(feed_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created ON item_bookmarks(user_id, created_at DESC, item_id DESC);
CREATE INDEX IF NOT EXISTS idx_items_lead_version ON items(lead_version);
CREATE INDEX IF NOT EXISTS idx_items_fulltext_candidates ON items(feed_id, created_at DESC)
  WHERE link IS NOT NULL AND full_content_html IS NULL AND extraction_status != 'feed_only';

-- Avoid rebuilding FTS5 entries when non-indexed item columns change during polling or extraction
DROP TRIGGER IF EXISTS trg_items_fts_update;
CREATE TRIGGER trg_items_fts_update AFTER UPDATE ON items
WHEN OLD.title IS NOT NEW.title
  OR OLD.content_snippet IS NOT NEW.content_snippet
  OR OLD.content_html IS NOT NEW.content_html
  OR OLD.full_content_html IS NOT NEW.full_content_html
BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, content_snippet, content_html, full_content_html)
  VALUES ('delete', old.id, old.title, old.content_snippet, old.content_html, old.full_content_html);
  INSERT INTO items_fts(rowid, title, content_snippet, content_html, full_content_html)
  VALUES (new.id, new.title, new.content_snippet, new.content_html, new.full_content_html);
END;

-- Monotonic per-user sync sequence high-water mark across change log pruning
ALTER TABLE sync_state ADD COLUMN last_seq INTEGER NOT NULL DEFAULT 0;
UPDATE sync_state
SET last_seq = MAX(
  pruned_through,
  COALESCE((SELECT MAX(seq) FROM changes WHERE changes.user_id = sync_state.user_id), 0)
);

DROP TRIGGER IF EXISTS trg_changes_seq_insert;
CREATE TRIGGER trg_changes_seq_insert
AFTER INSERT ON changes
WHEN NEW.seq <= COALESCE((SELECT MAX(last_seq, pruned_through) FROM sync_state WHERE user_id = NEW.user_id), 0)
BEGIN
  UPDATE changes
  SET seq = MAX(
    COALESCE((SELECT MAX(seq) FROM changes WHERE user_id = NEW.user_id), 0),
    COALESCE((SELECT MAX(last_seq, pruned_through) FROM sync_state WHERE user_id = NEW.user_id), 0)
  ) + 1
  WHERE user_id = NEW.user_id AND entity = NEW.entity AND entity_id = NEW.entity_id;
END;

DROP TRIGGER IF EXISTS trg_changes_seq_update;
CREATE TRIGGER trg_changes_seq_update
AFTER UPDATE OF seq ON changes
WHEN NEW.seq <= COALESCE((SELECT MAX(last_seq, pruned_through) FROM sync_state WHERE user_id = NEW.user_id), 0)
BEGIN
  UPDATE changes
  SET seq = MAX(
    COALESCE((SELECT MAX(seq) FROM changes WHERE user_id = NEW.user_id), 0),
    COALESCE((SELECT MAX(last_seq, pruned_through) FROM sync_state WHERE user_id = NEW.user_id), 0)
  ) + 1
  WHERE user_id = NEW.user_id AND entity = NEW.entity AND entity_id = NEW.entity_id;
END;

-- Record old feed deletion when a subscription moves to a different feed
DROP TRIGGER IF EXISTS trg_changes_subscription_move;
CREATE TRIGGER trg_changes_subscription_move
AFTER UPDATE OF feed_id ON subscriptions
WHEN OLD.feed_id IS NOT NEW.feed_id
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (OLD.user_id, 'subscription', OLD.feed_id, 'delete', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = OLD.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

-- Notify subscribers when a feed's URL or poll interval is updated in place
DROP TRIGGER IF EXISTS trg_changes_feed_update;
CREATE TRIGGER trg_changes_feed_update
AFTER UPDATE OF url, poll_interval_minutes ON feeds
WHEN OLD.url IS NOT NEW.url OR OLD.poll_interval_minutes IS NOT NEW.poll_interval_minutes
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  SELECT s.user_id, 'subscription', NEW.id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = s.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM subscriptions s
  WHERE s.feed_id = NEW.id
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;
