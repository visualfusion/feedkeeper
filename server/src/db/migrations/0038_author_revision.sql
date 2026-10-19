-- A client that already holds an item learns of a later author through the content revision. Only the revision
-- moves: the extraction status stays, so no full text is fetched again for it.
CREATE TRIGGER trg_author_revision AFTER UPDATE OF author ON items
WHEN OLD.author IS NOT NEW.author
BEGIN
  UPDATE items SET content_revision = OLD.content_revision + 1 WHERE id = NEW.id;
END;
