ALTER TABLE "ViewLog" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "ViewLog" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
CREATE INDEX IF NOT EXISTS "ViewLog_userId_storyId_createdAt_idx" ON "ViewLog" ("userId", "storyId", "createdAt");