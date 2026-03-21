ALTER TABLE "Story"
ADD COLUMN "storyOrigin" TEXT NOT NULL DEFAULT 'original',
ADD COLUMN "originalTitle" TEXT,
ADD COLUMN "originalAuthor" TEXT,
ADD COLUMN "originalLanguage" TEXT,
ADD COLUMN "translatorName" TEXT,
ADD COLUMN "translationGroup" TEXT,
ADD COLUMN "sourceName" TEXT,
ADD COLUMN "sourceUrl" TEXT;

CREATE INDEX "Story_storyOrigin_idx" ON "Story"("storyOrigin");