-- B6: Add boostScore to Story for homepage ranking
-- Each paid boost adds 1 to boostScore. Recommendation engine
-- sorts by boostScore * decay + views for homepage.

ALTER TABLE "Story"
  ADD COLUMN IF NOT EXISTS "boostScore" INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS "Story_boostScore_idx"
  ON "Story" ("boostScore" DESC);
