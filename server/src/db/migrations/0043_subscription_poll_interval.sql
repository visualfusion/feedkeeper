-- Each subscriber keeps their own poll interval; the feed runs at the shortest one. NULL means the server default.
-- Existing subscriptions take over the interval their feed has today, so nothing changes on upgrade.
ALTER TABLE subscriptions ADD COLUMN poll_interval_minutes INTEGER;

UPDATE subscriptions
SET poll_interval_minutes = (SELECT feeds.poll_interval_minutes FROM feeds WHERE feeds.id = subscriptions.feed_id)
WHERE feed_id IN (SELECT id FROM feeds WHERE is_system_inbox = 0);
