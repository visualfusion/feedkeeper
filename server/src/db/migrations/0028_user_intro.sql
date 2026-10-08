-- The short introduction to the app is shown to every account once; this is when the person closed it (NULL: not yet).
ALTER TABLE users ADD COLUMN intro_dismissed_at TEXT;
