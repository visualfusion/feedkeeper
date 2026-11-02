-- Notify subscribers when a feed's URL, metadata, poll interval, or error state is updated
DROP TRIGGER IF EXISTS trg_changes_feed_update;
CREATE TRIGGER trg_changes_feed_update
AFTER UPDATE OF url, title, site_url, poll_interval_minutes, last_error ON feeds
WHEN OLD.url IS NOT NEW.url
  OR OLD.title IS NOT NEW.title
  OR OLD.site_url IS NOT NEW.site_url
  OR OLD.poll_interval_minutes IS NOT NEW.poll_interval_minutes
  OR OLD.last_error IS NOT NEW.last_error
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  SELECT s.user_id, 'subscription', NEW.id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = s.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM subscriptions s
  WHERE s.feed_id = NEW.id
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;
