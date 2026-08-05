-- Author Level System Migration
-- Create tables for author levels and badges

CREATE TABLE IF NOT EXISTS "AuthorLevel" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "level" INTEGER NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "minViews" INTEGER NOT NULL,
    "minStories" INTEGER DEFAULT 0,
    "minEarnings" INTEGER DEFAULT 0,
    "badgeColor" TEXT DEFAULT '#666',
    "avatarFrame" TEXT,
    "benefits" TEXT[],
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "AuthorBadge" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "authorId" TEXT NOT NULL,
    "badgeType" TEXT NOT NULL,
    "earnedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add relations to User model
ALTER TABLE "AuthorBadge" ADD CONSTRAINT "AuthorBadge_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "AuthorBadge_authorId_idx" ON "AuthorBadge"("authorId");
CREATE INDEX IF NOT EXISTS "AuthorBadge_badgeType_idx" ON "AuthorBadge"("badgeType");

-- Seed default author levels (Vietnamese military-inspired ranks)
INSERT INTO "AuthorLevel" ("level", "name", "minViews", "minStories", "minEarnings", "badgeColor", "benefits") VALUES
(1, 'Tân binh', 0, 0, 0, '#9CA3AF', NULL),
(2, 'Hạ sĩ', 1000, 1, 100, '#6B7280', NULL),
(3, 'Trung sĩ', 5000, 2, 500, '#059669', NULL),
(4, 'Thượng sĩ', 20000, 3, 2000, '#0891B2', NULL),
(5, 'Binh nhất', 50000, 5, 5000, '#7C3AED', NULL),
(6, 'Hạ cấp tác', 100000, 8, 10000, '#DB2777', NULL),
(7, 'Trung cấp tác', 250000, 12, 25000, '#EA580C', NULL),
(8, 'Thượng cấp tác', 500000, 15, 50000, '#DC2626', NULL),
(9, 'Phó đề', 1000000, 20, 100000, '#CA8A04', NULL),
(10, 'Đại tác gia', 2000000, 25, 200000, '#818CF8', NULL)
ON CONFLICT ("level") DO NOTHING;
