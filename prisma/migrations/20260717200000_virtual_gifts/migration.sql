-- Virtual Gifts System migration
-- Creates GiftType and GiftTransaction tables for virtual gift functionality

-- GiftType: Available virtual gift options (flowers, cakes, diamonds, etc.)
CREATE TABLE IF NOT EXISTS "GiftType" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "animationUrl" TEXT,
    "isActive" BOOLEAN DEFAULT true,
    "sortOrder" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GiftTransaction: Records of gifts sent from users to authors
CREATE TABLE IF NOT EXISTS "GiftTransaction" (
    "id" TEXT NOT NULL DEFAULT cuid(),
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "storyId" TEXT,
    "giftTypeId" TEXT NOT NULL,
    "quantity" INTEGER DEFAULT 1,
    "totalCoins" INTEGER NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for GiftTransaction
CREATE INDEX IF NOT EXISTS "GiftTransaction_senderId_idx" ON "GiftTransaction"("senderId");
CREATE INDEX IF NOT EXISTS "GiftTransaction_receiverId_idx" ON "GiftTransaction"("receiverId");
CREATE INDEX IF NOT EXISTS "GiftTransaction_storyId_idx" ON "GiftTransaction"("storyId");
CREATE INDEX IF NOT EXISTS "GiftTransaction_createdAt_idx" ON "GiftTransaction"("createdAt");

-- Seed default gift types
INSERT INTO "GiftType" ("id", "name", "emoji", "price", "animationUrl", "isActive", "sortOrder", "createdAt")
VALUES
    (cuid(), 'Hoa hồng', '🌹', 10, NULL, true, 1, CURRENT_TIMESTAMP),
    (cuid(), 'Bánh kem', '🎂', 50, NULL, true, 2, CURRENT_TIMESTAMP),
    (cuid(), 'Kẹo ngọt', '🍬', 20, NULL, true, 3, CURRENT_TIMESTAMP),
    (cuid(), 'Sao', '⭐', 100, NULL, true, 4, CURRENT_TIMESTAMP),
    (cuid(), 'Kim cương', '💎', 500, NULL, true, 5, CURRENT_TIMESTAMP),
    (cuid(), 'Tên lửa', '🚀', 1000, NULL, true, 6, CURRENT_TIMESTAMP),
    (cuid(), 'Xe hơi', '🚗', 5000, NULL, true, 7, CURRENT_TIMESTAMP),
    (cuid(), 'Nhà phố', '🏠', 10000, NULL, true, 8, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
