-- Clear small user/org avatars stored as hero images (e.g. GitHub release/commit/activity Atom feeds).
UPDATE items
SET image_url = NULL
WHERE image_url LIKE 'https://avatars.githubusercontent.com/%'
   OR image_url LIKE 'http://avatars.githubusercontent.com/%';
