-- Fan Club System
-- Tables for fan clubs with VIP tiers and badges

-- FanClub: Each author can have one fan club
CREATE TABLE IF NOT EXISTS "FanClub" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "authorId" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "totalFans" INTEGER DEFAULT 0,
    "totalCoins" INTEGER DEFAULT 0,
    "bannerImage" TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- FanClubMember: Members of a fan club with tier tracking
CREATE TABLE IF NOT EXISTS "FanClubMember" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" TEXT DEFAULT 'member' CHECK ("tier" IN ('member', 'vip', 'svip')),
    "tierCoins" INTEGER DEFAULT 0,
    "joinedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("clubId", "userId")
);

-- FanClubActivity: Activity log for fan club actions
CREATE TABLE IF NOT EXISTS "FanClubActivity" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL CHECK ("action" IN ('joined', 'upgraded', 'donated', 'milestone')),
    "coins" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "FanClub_authorId_idx" ON "FanClub"("authorId");
CREATE INDEX IF NOT EXISTS "FanClubMember_clubId_idx" ON "FanClubMember"("clubId");
CREATE INDEX IF NOT EXISTS "FanClubMember_userId_idx" ON "FanClubMember"("userId");
CREATE INDEX IF NOT EXISTS "FanClubMember_tier_idx" ON "FanClubMember"("tier");
CREATE INDEX IF NOT EXISTS "FanClubActivity_clubId_idx" ON "FanClubActivity"("clubId");
CREATE INDEX IF NOT EXISTS "FanClubActivity_createdAt_idx" ON "FanClubActivity"("createdAt");
