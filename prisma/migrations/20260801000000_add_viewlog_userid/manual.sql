-- Add userId + userAgent to ViewLog for better dedup + bot audit
ALTER TABLE "ViewLog"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT;

-- Index for user-based dedup: 1 view per user per story per hour
CREATE INDEX IF NOT EXISTS "ViewLog_userId_storyId_createdAt_idx"
  ON "ViewLog" ("userId", "storyId", "createdAt");