-- Plain-text beginning of an article without page chrome, derived whenever its content changes. The version says
-- which cleaning rules produced it, so a rule change is picked up by the background backfill.
ALTER TABLE items ADD COLUMN content_lead TEXT;
ALTER TABLE items ADD COLUMN lead_version INTEGER;
