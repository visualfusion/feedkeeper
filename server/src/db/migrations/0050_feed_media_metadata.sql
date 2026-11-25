ALTER TABLE feeds ADD COLUMN description TEXT;
ALTER TABLE feeds ADD COLUMN artwork_url TEXT;
ALTER TABLE feeds ADD COLUMN detected_kind TEXT NOT NULL DEFAULT 'article';

ALTER TABLE subscriptions ADD COLUMN kind_override TEXT;
