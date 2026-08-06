-- Add ViewLog.userId + supporting indexes (user-scoped view tracking & dedup)
ALTER TABLE "ViewLog" ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "ViewLog_userId_storyId_createdAt_idx" ON "ViewLog"("userId", "storyId", "createdAt");
CREATE INDEX IF NOT EXISTS "ViewLog_ip_storyId_createdAt_idx" ON "ViewLog"("ip", "storyId", "createdAt");
CREATE INDEX IF NOT EXISTS "ViewLog_ip_createdAt_idx" ON "ViewLog"("ip", "createdAt");