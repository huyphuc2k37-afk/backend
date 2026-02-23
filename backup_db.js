/**
 * Database backup script — creates a pg_dump backup file
 * 
 * Usage:
 *   node backup_db.js
 * 
 * Output: ./backups/vstory_YYYY-MM-DD_HH-mm-ss.sql
 * 
 * Schedule with cron/Task Scheduler for daily backups.
 * Also run BEFORE any schema changes.
 */
require("dotenv").config();
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Parse the DIRECT_URL (non-pooled connection required for pg_dump)
const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("❌ No DATABASE_URL or DIRECT_URL found in .env");
  process.exit(1);
}

// Create backups directory
const backupDir = path.join(__dirname, "backups");
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

// Generate filename with timestamp
const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const filename = `vstory_${timestamp}.sql`;
const filepath = path.join(backupDir, filename);

console.log(`📦 Starting backup...`);
console.log(`   Database: ${dbUrl.replace(/:[^:]*@/, ":****@")}`);
console.log(`   Output: ${filepath}\n`);

try {
  // Use pg_dump via the connection string
  // --no-owner: don't include ownership commands
  // --no-privileges: don't include privilege commands  
  // --schema=public: only backup public schema
  // --data-only is removed so we get both schema + data
  execSync(
    `pg_dump "${dbUrl}" --no-owner --no-privileges --schema=public --file="${filepath}"`,
    { stdio: "inherit", timeout: 120000 }
  );

  const stats = fs.statSync(filepath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  
  console.log(`\n✅ Backup complete!`);
  console.log(`   File: ${filename}`);
  console.log(`   Size: ${sizeMB} MB`);

  // Keep only last 30 backups
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith("vstory_") && f.endsWith(".sql"))
    .sort()
    .reverse();

  if (files.length > 30) {
    const toDelete = files.slice(30);
    toDelete.forEach(f => {
      fs.unlinkSync(path.join(backupDir, f));
      console.log(`   🗑️ Deleted old backup: ${f}`);
    });
  }

} catch (error) {
  console.error("❌ Backup failed!");
  console.error("   Make sure pg_dump is installed (PostgreSQL client tools)");
  console.error("   Install: https://www.postgresql.org/download/");
  console.error(`   Error: ${error.message}`);
  
  // Fallback: use Prisma to dump essential data as JSON
  console.log("\n🔄 Attempting JSON fallback backup...");
  fallbackJsonBackup(filepath.replace(".sql", ".json"));
}

async function fallbackJsonBackup(jsonPath) {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const data = {
      exportedAt: new Date().toISOString(),
      users: await prisma.user.findMany(),
      stories: await prisma.story.findMany(),
      chapters: await prisma.chapter.findMany(),
      comments: await prisma.comment.findMany(),
      bookmarks: await prisma.bookmark.findMany(),
      readHistory: await prisma.readHistory.findMany(),
      deposits: await prisma.deposit.findMany(),
      chapterPurchases: await prisma.chapterPurchase.findMany(),
      withdrawals: await prisma.withdrawal.findMany(),
      categories: await prisma.category.findMany(),
      tags: await prisma.tag.findMany(),
      storyTags: await prisma.storyTag.findMany(),
      storyLikes: await prisma.storyLike.findMany(),
      ratings: await prisma.rating.findMany(),
      authorEarnings: await prisma.authorEarning.findMany(),
      platformEarnings: await prisma.platformEarning.findMany(),
      referralEarnings: await prisma.referralEarning.findMany(),
      notifications: await prisma.notification.findMany(),
      follows: await prisma.follow.findMany(),
      announcements: await prisma.announcement.findMany(),
      redirects: await prisma.redirect.findMany(),
      conversations: await prisma.conversation.findMany(),
      conversationParticipants: await prisma.conversationParticipant.findMany(),
      messages: await prisma.message.findMany(),
      viewLogs: await prisma.viewLog.findMany(),
      dailyQuests: await prisma.dailyQuest.findMany(),
      commentLikes: await prisma.commentLike.findMany(),
    };

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    const stats = fs.statSync(jsonPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`✅ JSON backup complete: ${path.basename(jsonPath)} (${sizeMB} MB)`);
  } catch (err) {
    console.error("❌ JSON backup also failed:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}
