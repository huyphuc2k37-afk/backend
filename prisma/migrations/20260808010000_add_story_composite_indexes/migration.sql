-- Add composite indexes for common WHERE+ORDER BY combos on Story table.
-- This dramatically speeds up homepage queries that previously did full scans
-- (e.g., WHERE approvalStatus = 'approved' ORDER BY "updatedAt" DESC LIMIT 14).
-- See scripts/perf-test-home-endpoints.ts for before/after numbers.

-- Index 1: WHERE approvalStatus = 'approved' ORDER BY updatedAt DESC
-- Used by /api/stories (default list), /api/recommendations/home, etc.
CREATE INDEX IF NOT EXISTS "Story_approvalStatus_updatedAt_idx"
  ON "Story" ("approvalStatus", "updatedAt" DESC);

-- Index 2: WHERE categoryId = X ORDER BY updatedAt DESC
-- Used by /api/categories/:slug and /the-loai/[slug] pages.
CREATE INDEX IF NOT EXISTS "Story_approvalStatus_categoryId_updatedAt_idx"
  ON "Story" ("approvalStatus", "categoryId", "updatedAt" DESC);

-- Index 3: WHERE storyOrigin = 'translated'/'original' ORDER BY updatedAt DESC
-- Used by HomePage's "truyện dịch" tab + ranking by origin.
CREATE INDEX IF NOT EXISTS "Story_approvalStatus_storyOrigin_updatedAt_idx"
  ON "Story" ("approvalStatus", "storyOrigin", "updatedAt" DESC);

-- Index 4: WHERE genre ILIKE X ORDER BY updatedAt DESC
-- Used by legacy genre filter (when categoryId not yet set).
CREATE INDEX IF NOT EXISTS "Story_approvalStatus_genre_updatedAt_idx"
  ON "Story" ("approvalStatus", genre, "updatedAt" DESC);

-- Index 5: WHERE featuredSlot IS NOT NULL ORDER BY updatedAt DESC
-- Used by /api/stories?featured=true.
CREATE INDEX IF NOT EXISTS "Story_approvalStatus_featuredSlot_updatedAt_idx"
  ON "Story" ("approvalStatus", "featuredSlot", "updatedAt" DESC);

-- Index 6: WHERE approvalStatus = 'approved' ORDER BY views DESC
-- Used by rankings/hot stories (sort=views).
CREATE INDEX IF NOT EXISTS "Story_approvalStatus_views_idx"
  ON "Story" ("approvalStatus", views DESC);