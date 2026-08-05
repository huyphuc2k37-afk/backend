-- B6: also add boostedAt for decay calculation
ALTER TABLE "Story"
  ADD COLUMN IF NOT EXISTS "boostedAt" TIMESTAMP;
