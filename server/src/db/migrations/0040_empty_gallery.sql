-- Classification is shared publisher metadata, not a deletion or a per-user read state.
ALTER TABLE items ADD COLUMN is_empty_gallery INTEGER NOT NULL DEFAULT 0 CHECK (is_empty_gallery IN (0, 1));
-- Reuse the bounded metadata backfill; existing content and reading history stay intact.
UPDATE items SET lead_version = NULL;

CREATE TRIGGER trg_gallery_revision AFTER UPDATE OF is_empty_gallery ON items
WHEN OLD.is_empty_gallery IS NOT NEW.is_empty_gallery
BEGIN
  UPDATE items SET content_revision = content_revision + 1 WHERE id = NEW.id;
END;
