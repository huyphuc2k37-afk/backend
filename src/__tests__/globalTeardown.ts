/**
 * Global teardown — runs once after all tests finish.
 * Cleans up the test database.
 */
import { PrismaClient } from "@prisma/client";

export default async () => {
  // Clean up test data — truncate all tables
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL } },
  });
  try {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Story", "Chapter", "Bookmark",
      "Comment", "StoryLike", "Rating", "Deposit", "ChapterPurchase", "Withdrawal",
      "AuthorEarning", "PlatformEarning", "ReferralEarning", "Notification",
      "Follow", "Category", "Tag", "StoryTag", "ViewLog", "BannedIP", "BannedEmail",
      "MonthlyViewStats", "DailyQuest", "Announcement", "ConversationParticipant",
      "Message", "Conversation", "ReadHistory", "Redirect", "Quest", "QuestProgress"
      CASCADE`;
    console.log("\n🧹 Test database cleaned up");
  } catch (err) {
    console.warn("⚠️  Failed to clean up test database:", err);
  } finally {
    await prisma.$disconnect();
  }
};
