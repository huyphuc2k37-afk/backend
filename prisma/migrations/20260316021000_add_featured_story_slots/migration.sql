ALTER TABLE "Story"
ADD COLUMN "featuredSlot" INTEGER;

CREATE UNIQUE INDEX "Story_featuredSlot_key" ON "Story"("featuredSlot");