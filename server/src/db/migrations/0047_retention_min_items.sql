-- Migration 0047: Minimum items per feed exempt from age-based retention

INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('retention_min_items_per_feed', '30');
