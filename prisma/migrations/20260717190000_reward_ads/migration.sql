-- Reward Ads for Authors (Mục 15)
-- Allows authors to display ads on their stories and earn revenue

CREATE TABLE IF NOT EXISTS "AuthorAdConfig" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "authorId" TEXT NOT NULL UNIQUE,
    "enabled" BOOLEAN DEFAULT false,
    "adFrequency" INTEGER DEFAULT 3, -- Show ad every N chapters
    "revenueShare" FLOAT DEFAULT 0.7, -- Author gets 70%
    "totalEarnings" INTEGER DEFAULT 0,
    "pendingWithdrawal" INTEGER DEFAULT 0, -- earnings pending withdrawal
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "AuthorAdEarning" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "authorId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "chapterId" TEXT NOT NULL,
    "impressions" INTEGER DEFAULT 0,
    "earnings" INTEGER DEFAULT 0, -- coins earned (author's share)
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "AuthorAdLog" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "authorId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "adShown" BOOLEAN DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "AuthorAdConfig_authorId_idx" ON "AuthorAdConfig"("authorId");
CREATE INDEX IF NOT EXISTS "AuthorAdEarning_authorId_idx" ON "AuthorAdEarning"("authorId");
CREATE INDEX IF NOT EXISTS "AuthorAdEarning_storyId_idx" ON "AuthorAdEarning"("storyId");
CREATE INDEX IF NOT EXISTS "AuthorAdEarning_createdAt_idx" ON "AuthorAdEarning"("createdAt");
CREATE INDEX IF NOT EXISTS "AuthorAdLog_authorId_idx" ON "AuthorAdLog"("authorId");
CREATE INDEX IF NOT EXISTS "AuthorAdLog_storyId_idx" ON "AuthorAdLog"("storyId");
CREATE INDEX IF NOT EXISTS "AuthorAdLog_createdAt_idx" ON "AuthorAdLog"("createdAt");
