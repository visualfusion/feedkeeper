-- Migration 0032: publish dates that are not dates.
--
-- Entries whose feed gave a date that could not be read ("gestern", localised weekday names, an empty string) had
-- the raw text stored. Compared as text it sorted above every real date and never aged. Dates before 1991 and
-- dates more than a day ahead are placeholders (1970-01-01, year 9999). All of them become NULL, which makes the
-- app use the time it stored the article.
UPDATE items SET published_at = NULL
WHERE published_at IS NOT NULL AND julianday(published_at) IS NULL;

UPDATE items SET published_at = NULL
WHERE published_at IS NOT NULL
  AND (julianday(published_at) < julianday('1991-01-01') OR julianday(published_at) > julianday('now', '+1 day'));
