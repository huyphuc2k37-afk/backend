-- A7: Add viewCount column to AuthorEarning
-- Tracks how many views each "view" earning represents.
-- Without this column, /api/revenue fails with P2022.

ALTER TABLE "AuthorEarning"
  ADD COLUMN IF NOT EXISTS "viewCount" INTEGER DEFAULT 0;

-- Optional: backfill where view earnings exist (best-effort, 0 if no data)
UPDATE "AuthorEarning"
  SET "viewCount" = 0
WHERE type = 'view' AND "viewCount" IS NULL;
