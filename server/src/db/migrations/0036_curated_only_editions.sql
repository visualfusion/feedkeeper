-- Retire legacy automatic slots without dismissing the current curation period.
-- Keep the revision watermark so a late publication cannot silently overwrite newer state.
UPDATE editions SET status = 'expired', revision = revision + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source = 'automatic' AND status = 'active';
