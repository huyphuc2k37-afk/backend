-- Migration: add_view_quality_tracking
-- Description: Enhanced view tracking with device fingerprinting, quality scoring, and realtime stats

-- 1. Add columns to ViewLog
ALTER TABLE "ViewLog" ADD COLUMN IF NOT EXISTS "fingerprintId" TEXT;
ALTER TABLE "ViewLog" ADD COLUMN IF NOT EXISTS "qualityScore" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "ViewLog" ADD COLUMN IF NOT EXISTS "dwellTime" INTEGER DEFAULT 0;

-- 2. Create DeviceFingerprint table
CREATE TABLE IF NOT EXISTS "DeviceFingerprint" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "hash" TEXT NOT NULL,
    "ipAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "viewCount" INTEGER DEFAULT 0,
    "isBot" BOOLEAN DEFAULT false,
    "botScore" DOUBLE PRECISION DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceFingerprint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DeviceFingerprint_hash_key" ON "DeviceFingerprint"("hash");
CREATE INDEX IF NOT EXISTS "DeviceFingerprint_isBot_idx" ON "DeviceFingerprint"("isBot");
CREATE INDEX IF NOT EXISTS "DeviceFingerprint_botScore_idx" ON "DeviceFingerprint"("botScore");

-- Add foreign key to ViewLog
ALTER TABLE "ViewLog" ADD CONSTRAINT "ViewLog_fingerprintId_fkey"
    FOREIGN KEY ("fingerprintId") REFERENCES "DeviceFingerprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Create ViewSession table
CREATE TABLE IF NOT EXISTS "ViewSession" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "storyId" TEXT NOT NULL,
    "userId" TEXT,
    "fingerprintId" TEXT,
    "qualityScore" DOUBLE PRECISION DEFAULT 0,
    "dwellTime" INTEGER DEFAULT 0,
    "scrollDepth" DOUBLE PRECISION DEFAULT 0,
    "chaptersRead" INTEGER DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "ViewSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ViewSession_storyId_startedAt_idx" ON "ViewSession"("storyId", "startedAt");
CREATE INDEX IF NOT EXISTS "ViewSession_userId_idx" ON "ViewSession"("userId");
CREATE INDEX IF NOT EXISTS "ViewSession_fingerprintId_idx" ON "ViewSession"("fingerprintId");
CREATE INDEX IF NOT EXISTS "ViewSession_qualityScore_idx" ON "ViewSession"("qualityScore");

-- 4. Create RealtimeViewStats table
CREATE TABLE IF NOT EXISTS "RealtimeViewStats" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "todayViews" INTEGER DEFAULT 0,
    "weekViews" INTEGER DEFAULT 0,
    "monthViews" INTEGER DEFAULT 0,
    "activeNow" INTEGER DEFAULT 0,
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RealtimeViewStats_pkey" PRIMARY KEY ("id")
);

-- Insert initial realtime stats row
INSERT INTO "RealtimeViewStats" ("id", "todayViews", "weekViews", "monthViews", "activeNow")
VALUES ('global', 0, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- 5. Add indexes for ViewLog
CREATE INDEX IF NOT EXISTS "ViewLog_fingerprintId_createdAt_idx" ON "ViewLog"("fingerprintId", "createdAt");
