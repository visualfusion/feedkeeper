-- One event per committed feed update, not one waiting task per recipient.
-- Cursors are durable; one application process dispatches device deliveries.
CREATE TABLE push_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  max_item_id INTEGER NOT NULL,
  item_count INTEGER NOT NULL,
  subscription_ceiling INTEGER NOT NULL,
  subscription_cursor INTEGER NOT NULL DEFAULT 0,
  current_subscription INTEGER NOT NULL DEFAULT 0,
  device_cursor INTEGER NOT NULL DEFAULT 0,
  device_ceiling INTEGER NOT NULL DEFAULT 0,
  target_device INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_outbox_due ON push_outbox(available_at, id);
CREATE INDEX idx_push_outbox_feed ON push_outbox(feed_id, id);
