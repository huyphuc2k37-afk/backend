/**
 * Clean database: Remove ALL data except the admin account
 * Admin: seringuyen0506@gmail.com
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const ADMIN_EMAIL = "seringuyen0506@gmail.com";

async function cleanDb() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Clean DB — Keep admin only              ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // 1. Get admin user
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    console.error("❌ Admin not found! Run setup_db.js first.");
    process.exit(1);
  }
  console.log(`✅ Admin found: ${admin.email} (${admin.id})\n`);

  // 2. Delete in dependency order (children first)
  const tables = [
    { name: "CommentLike", fn: () => prisma.commentLike.deleteMany() },
    { name: "Comment", fn: () => prisma.comment.deleteMany() },
    { name: "ChapterPurchase", fn: () => prisma.chapterPurchase.deleteMany() },
    { name: "ReadHistory", fn: () => prisma.readHistory.deleteMany() },
    { name: "Bookmark", fn: () => prisma.bookmark.deleteMany() },
    { name: "StoryLike", fn: () => prisma.storyLike.deleteMany() },
    { name: "Rating", fn: () => prisma.rating.deleteMany() },
    { name: "StoryTag", fn: () => prisma.storyTag.deleteMany() },
    { name: "ViewLog", fn: () => prisma.viewLog.deleteMany() },
    { name: "Chapter", fn: () => prisma.chapter.deleteMany() },
    { name: "Story", fn: () => prisma.story.deleteMany() },
    { name: "AuthorEarning", fn: () => prisma.authorEarning.deleteMany() },
    { name: "PlatformEarning", fn: () => prisma.platformEarning.deleteMany() },
    { name: "ReferralEarning", fn: () => prisma.referralEarning.deleteMany() },
    { name: "Deposit", fn: () => prisma.deposit.deleteMany() },
    { name: "Withdrawal", fn: () => prisma.withdrawal.deleteMany() },
    { name: "Notification", fn: () => prisma.notification.deleteMany() },
    { name: "DailyQuest", fn: () => prisma.dailyQuest.deleteMany() },
    { name: "Follow", fn: () => prisma.follow.deleteMany() },
    { name: "Message", fn: () => prisma.message.deleteMany() },
    { name: "ConversationParticipant", fn: () => prisma.conversationParticipant.deleteMany() },
    { name: "Conversation", fn: () => prisma.conversation.deleteMany() },
    { name: "Announcement", fn: () => prisma.announcement.deleteMany() },
    { name: "Redirect", fn: () => prisma.redirect.deleteMany() },
    { name: "Category", fn: () => prisma.category.deleteMany() },
    { name: "Tag", fn: () => prisma.tag.deleteMany() },
    // Delete all users EXCEPT admin
    { name: "User (non-admin)", fn: () => prisma.user.deleteMany({ where: { email: { not: ADMIN_EMAIL } } }) },
  ];

  for (const { name, fn } of tables) {
    const result = await fn();
    console.log(`  🗑️  ${name}: ${result.count} deleted`);
  }

  // 3. Reset admin to clean state
  await prisma.user.update({
    where: { email: ADMIN_EMAIL },
    data: {
      role: "admin",
      provider: "google",
      coinBalance: 0,
      referralCode: null,
      referredById: null,
      isSuperMod: false,
    },
  });

  console.log(`\n✅ Database cleaned. Only admin remains.\n`);

  // 4. Verify
  const stats = {
    users: await prisma.user.count(),
    stories: await prisma.story.count(),
    chapters: await prisma.chapter.count(),
  };
  console.log(`Users: ${stats.users}, Stories: ${stats.stories}, Chapters: ${stats.chapters}`);

  const adminCheck = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true, name: true, email: true, role: true },
  });
  console.log(`Admin: ${JSON.stringify(adminCheck)}\n`);
}

cleanDb()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
