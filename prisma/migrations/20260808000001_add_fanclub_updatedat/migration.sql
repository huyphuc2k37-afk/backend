-- Add updatedAt columns to FanClub and FanClubMember
-- (Required by Prisma schema; previous migration omitted these)

ALTER TABLE "FanClub"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "FanClubMember"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
