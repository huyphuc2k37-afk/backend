-- Migration: ads_system
-- Description: Add tables for ads system - ad placements, impressions, and rewards

-- 1. Create AdPlacement table (configures where and what ads to show)
CREATE TABLE IF NOT EXISTS "AdPlacement" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "location" TEXT NOT NULL, -- banner_top, banner_sidebar, banner_footer, in_content, reward_video
    "isActive" BOOLEAN DEFAULT true,
    "adNetwork" TEXT DEFAULT 'google', -- google, admob, facebook, custom
    "adUnitId" TEXT, -- AdMob Ad Unit ID or Google Ad Manager placement ID
    "priority" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdPlacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdPlacement_location_key" ON "AdPlacement"("location");
CREATE INDEX IF NOT EXISTS "AdPlacement_location_idx" ON "AdPlacement"("location");
CREATE INDEX IF NOT EXISTS "AdPlacement_isActive_idx" ON "AdPlacement"("isActive");

-- 2. Create AdImpression table (tracks when ads are shown)
CREATE TABLE IF NOT EXISTS "AdImpression" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT, -- null for anonymous users
    "storyId" TEXT, -- context: which story the ad appeared in
    "chapterId" TEXT, -- context: which chapter (for in-content ads)
    "placement" TEXT NOT NULL, -- banner_top, banner_sidebar, banner_footer, in_content, reward_video
    "adNetwork" TEXT, -- google, admob, facebook
    "adUnitId" TEXT, -- the actual ad unit that was shown
    "impressionTime" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdImpression_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdImpression_userId_idx" ON "AdImpression"("userId");
CREATE INDEX IF NOT EXISTS "AdImpression_storyId_idx" ON "AdImpression"("storyId");
CREATE INDEX IF NOT EXISTS "AdImpression_placement_idx" ON "AdImpression"("placement");
CREATE INDEX IF NOT EXISTS "AdImpression_impressionTime_idx" ON "AdImpression"("impressionTime" DESC);
CREATE INDEX IF NOT EXISTS "AdImpression_userId_placement_idx" ON "AdImpression"("userId", "placement");

-- 3. Create AdReward table (tracks reward video ad completions)
CREATE TABLE IF NOT EXISTS "AdReward" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "coins" INTEGER NOT NULL DEFAULT 5,
    "watchedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdReward_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdReward_userId_idx" ON "AdReward"("userId");
CREATE INDEX IF NOT EXISTS "AdReward_userId_watchedAt_idx" ON "AdReward"("userId", "watchedAt" DESC);

-- 4. Create AdAnalytics table (aggregated daily statistics)
CREATE TABLE IF NOT EXISTS "AdAnalytics" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "date" TEXT NOT NULL, -- YYYY-MM-DD format
    "placement" TEXT NOT NULL,
    "impressions" INTEGER DEFAULT 0,
    "uniqueUsers" INTEGER DEFAULT 0,
    "rewardsClaimed" INTEGER DEFAULT 0,
    "coinsDistributed" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdAnalytics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdAnalytics_date_placement_key" UNIQUE ("date", "placement")
);

CREATE INDEX IF NOT EXISTS "AdAnalytics_date_idx" ON "AdAnalytics"("date" DESC);
CREATE INDEX IF NOT EXISTS "AdAnalytics_placement_idx" ON "AdAnalytics"("placement");
