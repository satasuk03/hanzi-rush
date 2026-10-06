-- 0002_push_ids.sql: remember the last accepted PUT /save ids (JSON array, oldest first, max 16)
-- so a client that lost a 200 reply can tell its push landed (see docs/backend.md §5).
ALTER TABLE saves ADD COLUMN push_ids TEXT NOT NULL DEFAULT '[]';
