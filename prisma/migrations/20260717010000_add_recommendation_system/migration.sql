-- Migration: add_recommendation_system
-- Description: Add tables for recommendation engine - user profiles, story similarity, and recommendation logs

-- 1. Create UserReadingProfile table
CREATE TABLE IF NOT EXISTS "UserReadingProfile" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "userId" TEXT NOT NULL UNIQUE,
    "favoriteGenres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avgReadLength" INTEGER DEFAULT 0,
    "preferredOrigin" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "popularityLevel" TEXT DEFAULT 'medium',
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserReadingProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserReadingProfile_userId_key" ON "UserReadingProfile"("userId");
CREATE INDEX IF NOT EXISTS "UserReadingProfile_userId_idx" ON "UserReadingProfile"("userId");

-- 2. Create StorySimilarity table
CREATE TABLE IF NOT EXISTS "StorySimilarity" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "storyIdA" TEXT NOT NULL,
    "storyIdB" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StorySimilarity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StorySimilarity_storyIdA_storyIdB_key" ON "StorySimilarity"("storyIdA", "storyIdB");
CREATE INDEX IF NOT EXISTS "StorySimilarity_storyIdA_similarity_idx" ON "StorySimilarity"("storyIdA", "similarity" DESC);
CREATE INDEX IF NOT EXISTS "StorySimilarity_storyIdB_similarity_idx" ON "StorySimilarity"("storyIdB", "similarity" DESC);

-- 3. Create RecommendationLog table
CREATE TABLE IF NOT EXISTS "RecommendationLog" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "userId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'unknown',
    "clicked" BOOLEAN DEFAULT false,
    "viewed" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RecommendationLog_userId_createdAt_idx" ON "RecommendationLog"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "RecommendationLog_storyId_idx" ON "RecommendationLog"("storyId");
CREATE INDEX IF NOT EXISTS "RecommendationLog_userId_idx" ON "RecommendationLog"("userId");

-- 4. Create StoryRecommendationScore table (pre-computed scores)
CREATE TABLE IF NOT EXISTS "StoryRecommendationScore" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "storyId" TEXT NOT NULL,
    "scoreType" TEXT NOT NULL DEFAULT 'collaborative',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryRecommendationScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StoryRecommendationScore_storyId_scoreType_key" ON "StoryRecommendationScore"("storyId", "scoreType");
CREATE INDEX IF NOT EXISTS "StoryRecommendationScore_scoreType_score_idx" ON "StoryRecommendationScore"("scoreType", "score" DESC);

-- 5. Create GenreStats table (for genre-based recommendations)
CREATE TABLE IF NOT EXISTS "GenreStats" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "genre" TEXT NOT NULL UNIQUE,
    "totalViews" BIGINT DEFAULT 0,
    "totalStories" INTEGER DEFAULT 0,
    "avgRating" DOUBLE PRECISION DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenreStats_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GenreStats_genre_idx" ON "GenreStats"("genre");
CREATE INDEX IF NOT EXISTS "GenreStats_totalViews_idx" ON "GenreStats"("totalViews" DESC);
