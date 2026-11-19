ALTER TABLE push_devices RENAME TO push_devices_web;
DROP INDEX idx_push_devices_user;

CREATE TABLE push_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE,
  p256dh TEXT,
  auth TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  native_device_id INTEGER UNIQUE REFERENCES personal_access_tokens(id) ON DELETE CASCADE,
  native_token TEXT,
  native_environment TEXT CHECK(native_environment IN ('development', 'production')),
  native_language TEXT,
  native_feeds INTEGER NOT NULL DEFAULT 0,
  native_editions INTEGER NOT NULL DEFAULT 0,
  CHECK (
    (endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL AND native_device_id IS NULL) OR
    (endpoint IS NULL AND native_device_id IS NOT NULL AND native_token IS NOT NULL AND native_environment IS NOT NULL AND native_language IS NOT NULL)
  )
);

INSERT INTO push_devices (id, user_id, endpoint, p256dh, auth, created_at)
SELECT id, user_id, endpoint, p256dh, auth, created_at FROM push_devices_web;

-- Delivery cursors in the existing outbox refer to the original ID sequence.
UPDATE sqlite_sequence SET seq = MAX(seq, (SELECT seq FROM sqlite_sequence WHERE name = 'push_devices_web'))
WHERE name = 'push_devices';
INSERT INTO sqlite_sequence (name, seq)
SELECT 'push_devices', seq FROM sqlite_sequence WHERE name = 'push_devices_web'
AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'push_devices');
DROP TABLE push_devices_web;
CREATE INDEX idx_push_devices_user ON push_devices(user_id);
