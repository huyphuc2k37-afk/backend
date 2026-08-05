/**
 * Global setup — runs once before all tests.
 * Creates the test database schema (or resets it).
 */
import "dotenv/config";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export default async () => {
  // Ensure .env.test exists (or .env is already loaded via dotenv)
  // Run Prisma migrations to ensure schema is up to date
  try {
    console.log("\n🗄️  Setting up test database...");
    execSync("npx prisma migrate deploy", {
      cwd: join(__dirname, "../.."),
      stdio: "inherit",
      env: { ...process.env },
    });
    console.log("✅ Test database schema ready\n");
  } catch (err) {
    console.error("❌ Failed to set up test database:", err);
    // Don't fail globally — let individual tests decide
    console.warn("⚠️  Database setup failed. Tests that need DB will fail.");
  }
};
