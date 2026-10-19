ALTER TABLE full_text_jobs ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
UPDATE full_text_jobs SET created_at = available_at;
ALTER TABLE full_text_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE full_text_jobs ADD COLUMN force INTEGER NOT NULL DEFAULT 0;
CREATE TABLE full_text_hosts (host TEXT PRIMARY KEY, retry_at TEXT NOT NULL);
