-- AlterTable
ALTER TABLE "User" ADD COLUMN     "coinBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "coins" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "transferNote" TEXT,
    "proofImage" TEXT,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapterPurchase" (
    "id" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,

    CONSTRAINT "ChapterPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "moneyAmount" INTEGER NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankAccount" TEXT NOT NULL,
    "bankHolder" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChapterPurchase_userId_chapterId_key" ON "ChapterPurchase"("userId", "chapterId");

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterPurchase" ADD CONSTRAINT "ChapterPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterPurchase" ADD CONSTRAINT "ChapterPurchase_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
