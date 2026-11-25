-- Notify subscribers when feed media metadata (description, artwork_url, detected_kind) changes
DROP TRIGGER IF EXISTS trg_changes_feed_update;
CREATE TRIGGER trg_changes_feed_update
AFTER UPDATE OF url, title, site_url, poll_interval_minutes, last_error, description, artwork_url, detected_kind ON feeds
WHEN OLD.url IS NOT NEW.url
  OR OLD.title IS NOT NEW.title
  OR OLD.site_url IS NOT NEW.site_url
  OR OLD.poll_interval_minutes IS NOT NEW.poll_interval_minutes
  OR OLD.last_error IS NOT NEW.last_error
  OR OLD.description IS NOT NEW.description
  OR OLD.artwork_url IS NOT NEW.artwork_url
  OR OLD.detected_kind IS NOT NEW.detected_kind
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  SELECT s.user_id, 'subscription', NEW.id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = s.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM subscriptions s
  WHERE s.feed_id = NEW.id
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

-- Enqueue a sync upsert for subscriptions whose feed already received artwork_url or description before this trigger existed
INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
SELECT
  s.user_id,
  'subscription',
  f.id,
  'upsert',
  (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = s.user_id),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM subscriptions s
JOIN feeds f ON f.id = s.feed_id
WHERE f.artwork_url IS NOT NULL OR f.description IS NOT NULL
ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
