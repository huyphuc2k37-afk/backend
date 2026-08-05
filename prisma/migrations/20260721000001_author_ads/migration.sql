-- Author Ad System: 3 new models
-- AuthorAdConfig, AuthorAdEarning, AuthorAdLog

CREATE TABLE IF NOT EXISTS "AuthorAdConfig" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "authorId" TEXT NOT NULL,
    "enabled" BOOLEAN DEFAULT true,
    "adFrequency" INTEGER DEFAULT 5,
    "revenueShare" DOUBLE PRECISION DEFAULT 0.7,
    "totalEarnings" INTEGER DEFAULT 0,
    "pendingWithdrawal" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthorAdConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthorAdConfig_authorId_key" UNIQUE ("authorId")
);

CREATE TABLE IF NOT EXISTS "AuthorAdEarning" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "authorId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "impressions" INTEGER DEFAULT 0,
    "earnings" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthorAdEarning_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthorAdEarning_authorId_storyId_chapterId_key" UNIQUE ("authorId", "storyId", "chapterId")
);

CREATE TABLE IF NOT EXISTS "AuthorAdLog" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "authorId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "adShown" BOOLEAN DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthorAdLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuthorAdConfig_authorId_idx" ON "AuthorAdConfig"("authorId");
CREATE INDEX IF NOT EXISTS "AuthorAdEarning_authorId_createdAt_idx" ON "AuthorAdEarning"("authorId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuthorAdEarning_storyId_idx" ON "AuthorAdEarning"("storyId");
CREATE INDEX IF NOT EXISTS "AuthorAdLog_authorId_idx" ON "AuthorAdLog"("authorId");
CREATE INDEX IF NOT EXISTS "AuthorAdLog_storyId_idx" ON "AuthorAdLog"("storyId");
CREATE INDEX IF NOT EXISTS "AuthorAdLog_createdAt_idx" ON "AuthorAdLog"("createdAt");
