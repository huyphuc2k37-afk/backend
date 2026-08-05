-- Affiliate System Migration
-- Create tables for tracking affiliate links, clicks, and commissions

CREATE TABLE IF NOT EXISTS "AffiliateLink" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL UNIQUE,
    "destination" TEXT NOT NULL,
    "targetId" TEXT,
    "targetTitle" TEXT,
    "clickCount" INTEGER DEFAULT 0,
    "conversionCount" INTEGER DEFAULT 0,
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "AffiliateClick" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "linkId" TEXT NOT NULL,
    "userId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "clickedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "AffiliateEarning" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "userId" TEXT NOT NULL,
    "referralUserId" TEXT,
    "linkId" TEXT,
    "action" TEXT NOT NULL,
    "commission" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "AffiliateLink_userId_idx" ON "AffiliateLink"("userId");
CREATE INDEX IF NOT EXISTS "AffiliateLink_code_idx" ON "AffiliateLink"("code");
CREATE INDEX IF NOT EXISTS "AffiliateLink_destination_idx" ON "AffiliateLink"("destination");
CREATE INDEX IF NOT EXISTS "AffiliateClick_linkId_idx" ON "AffiliateClick"("linkId");
CREATE INDEX IF NOT EXISTS "AffiliateClick_clickedAt_idx" ON "AffiliateClick"("clickedAt");
CREATE INDEX IF NOT EXISTS "AffiliateEarning_userId_idx" ON "AffiliateEarning"("userId");
CREATE INDEX IF NOT EXISTS "AffiliateEarning_createdAt_idx" ON "AffiliateEarning"("createdAt");
