-- Paid Suggestions System Migration
-- Users pay 50 coins per suggestion to recommend a story to the homepage

-- Table for tracking paid suggestions (story promotions)
CREATE TABLE IF NOT EXISTS "PaidSuggestion" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "userId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "message" TEXT,
    "coinsSpent" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT DEFAULT 'pending', -- pending, approved, rejected, expired
    "expiresAt" TIMESTAMP,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaidSuggestion_pkey" PRIMARY KEY ("id")
);

-- Table for daily suggestion pool (featured stories of the day)
CREATE TABLE IF NOT EXISTS "SuggestionPool" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "date" DATE NOT NULL UNIQUE,
    "slots" INTEGER DEFAULT 5,
    "stories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuggestionPool_pkey" PRIMARY KEY ("id")
);

-- Indexes for PaidSuggestion
CREATE INDEX IF NOT EXISTS "PaidSuggestion_userId_idx" ON "PaidSuggestion"("userId");
CREATE INDEX IF NOT EXISTS "PaidSuggestion_storyId_idx" ON "PaidSuggestion"("storyId");
CREATE INDEX IF NOT EXISTS "PaidSuggestion_status_idx" ON "PaidSuggestion"("status");
CREATE INDEX IF NOT EXISTS "PaidSuggestion_createdAt_idx" ON "PaidSuggestion"("createdAt");
CREATE INDEX IF NOT EXISTS "PaidSuggestion_userId_createdAt_idx" ON "PaidSuggestion"("userId", "createdAt");

-- Indexes for SuggestionPool
CREATE INDEX IF NOT EXISTS "SuggestionPool_date_idx" ON "SuggestionPool"("date");
