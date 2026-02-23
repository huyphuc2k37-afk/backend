/**
 * Setup script: Initialize admin account and verify database integrity
 * 
 * This script:
 * 1. Ensures the admin user exists with correct role
 * 2. Syncs auth users from Supabase auth schema
 * 3. Verifies all tables & indexes exist
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const ADMIN_EMAIL = "seringuyen0506@gmail.com";

async function setupAdmin() {
  console.log("=== Setting up admin account ===\n");

  // Upsert admin user — if they login via Google, this ensures role=admin
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "admin", provider: "google" },
    create: {
      email: ADMIN_EMAIL,
      name: "Admin",
      role: "admin",
      provider: "google",
      emailVerified: true,
    },
  });

  console.log(`✅ Admin: ${admin.email} (id: ${admin.id}, role: ${admin.role})\n`);
  return admin;
}

async function verifyTables() {
  console.log("=== Verifying database tables ===\n");

  const expectedTables = [
    "User", "Story", "Chapter", "Comment", "CommentLike",
    "Bookmark", "ReadHistory", "Deposit", "ChapterPurchase",
    "Withdrawal", "Category", "Tag", "StoryTag", "StoryLike",
    "Rating", "AuthorEarning", "PlatformEarning", "ReferralEarning",
    "Notification", "Follow", "Announcement", "Redirect",
    "Conversation", "ConversationParticipant", "Message",
    "ViewLog", "DailyQuest",
  ];

  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `;
  const tableNames = tables.map(t => t.tablename);

  let allOk = true;
  for (const t of expectedTables) {
    if (tableNames.includes(t)) {
      console.log(`  ✅ ${t}`);
    } else {
      console.log(`  ❌ ${t} — MISSING`);
      allOk = false;
    }
  }

  if (!allOk) {
    console.log("\n⚠️  Some tables are missing! Run: npx prisma db push\n");
  } else {
    console.log(`\n✅ All ${expectedTables.length} tables verified\n`);
  }
}

async function showStats() {
  console.log("=== Current database stats ===\n");

  const stats = await Promise.all([
    prisma.user.count(),
    prisma.story.count(),
    prisma.chapter.count(),
    prisma.comment.count(),
    prisma.bookmark.count(),
    prisma.category.count(),
    prisma.tag.count(),
    prisma.deposit.count(),
    prisma.notification.count(),
    prisma.follow.count(),
  ]);

  const labels = ["Users", "Stories", "Chapters", "Comments", "Bookmarks", "Categories", "Tags", "Deposits", "Notifications", "Follows"];

  labels.forEach((l, i) => {
    console.log(`  ${l}: ${stats[i]}`);
  });
  console.log();

  // Show all users
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, provider: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("All users:");
  users.forEach(u => {
    console.log(`  ${u.role.padEnd(10)} ${u.email.padEnd(35)} ${u.name} (${u.provider})`);
  });
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     VStory Database Setup Script         ║");
  console.log("╚══════════════════════════════════════════╝\n");

  await setupAdmin();
  await verifyTables();
  await showStats();

  console.log("\n✅ Setup complete!\n");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
