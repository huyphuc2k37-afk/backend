-- B7: Extend AdPlacement with custom banner (shop manual) fields
ALTER TABLE "AdPlacement"
  ADD COLUMN IF NOT EXISTS "customImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "customVideoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "clickUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "advertiserName" TEXT,
  ADD COLUMN IF NOT EXISTS "advertiserPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "monthlyPrice" INTEGER,
  ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "paidUntil" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'network';