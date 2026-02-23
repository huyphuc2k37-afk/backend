/**
 * PRISMA SAFETY WRAPPER
 * 
 * This script intercepts dangerous Prisma commands to prevent
 * accidental data loss on production databases.
 * 
 * BLOCKED commands on production:
 * - prisma migrate dev (caused DROP SCHEMA CASCADE data loss)
 * - prisma migrate reset
 * - prisma db execute (raw SQL)
 * 
 * ALLOWED with auto-backup:
 * - prisma db push
 * - prisma db seed
 * 
 * Usage: node prisma_safe.js <command> [args...]
 * Example: node prisma_safe.js db push
 */
const { execSync } = require("child_process");
const path = require("path");

const args = process.argv.slice(2);
const command = args.join(" ");

// Check if this is a production database
const envFile = path.join(__dirname, ".env");
let isProduction = false;
try {
  const envContent = require("fs").readFileSync(envFile, "utf8");
  isProduction = envContent.includes("supabase.co") || envContent.includes("supabase.com");
} catch {}

// Dangerous commands that should NEVER run on production
const BLOCKED_COMMANDS = [
  "migrate dev",
  "migrate reset",
  "db execute",
];

// Commands that need auto-backup first
const BACKUP_COMMANDS = [
  "db push",
  "db seed",
  "migrate deploy",
];

if (isProduction) {
  // Check if command is blocked
  for (const blocked of BLOCKED_COMMANDS) {
    if (command.includes(blocked)) {
      console.error("╔══════════════════════════════════════════════════════╗");
      console.error("║  ❌ BLOCKED: Dangerous command on PRODUCTION DB!     ║");
      console.error("╚══════════════════════════════════════════════════════╝");
      console.error(`\n  Command: prisma ${command}`);
      console.error(`  Reason:  '${blocked}' can destroy production data.`);
      console.error(`\n  Safe alternatives:`);
      console.error(`    npx prisma db push     — sync schema without migrations`);
      console.error(`    npx prisma generate    — regenerate client only`);
      console.error(`\n  If you REALLY need this, use a local/staging database.\n`);
      process.exit(1);
    }
  }

  // Auto-backup before risky commands
  for (const risky of BACKUP_COMMANDS) {
    if (command.includes(risky)) {
      console.log("⚠️  Production database detected. Creating backup first...\n");
      try {
        execSync("node backup_db.js", { cwd: __dirname, stdio: "inherit" });
        console.log("\n✅ Backup complete. Proceeding with command...\n");
      } catch {
        console.error("\n⚠️  Backup failed, but proceeding anyway...\n");
      }
      break;
    }
  }
}

// Execute the actual prisma command
try {
  execSync(`npx prisma ${command}`, { cwd: __dirname, stdio: "inherit" });
} catch (error) {
  process.exit(error.status || 1);
}
