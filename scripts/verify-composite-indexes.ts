// Verify the new composite indexes are present on Supabase.
// Uses DIRECT_URL from .env (no pgBouncer).
// Refuses to run if connection resolves to localhost.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL is not set in .env");
  process.exit(1);
}
if (url.includes("127.0.0.1") || url.includes("localhost")) {
  console.error("REFUSING TO RUN: DIRECT_URL points to localhost.");
  process.exit(2);
}

const p = new PrismaClient({ datasources: { db: { url } } });

const INDEX_NAMES = [
  "Story_approvalStatus_updatedAt_idx",
  "Story_approvalStatus_categoryId_updatedAt_idx",
  "Story_approvalStatus_storyOrigin_updatedAt_idx",
  "Story_approvalStatus_genre_updatedAt_idx",
  "Story_approvalStatus_featuredSlot_updatedAt_idx",
  "Story_approvalStatus_views_idx",
];

async function main() {
  const conn = await p.$queryRaw<Array<{ db: string; host: string | null }>>`
    SELECT current_database() as db, inet_server_addr() as host
  `;
  console.log("Connected to:", conn[0]);

  // Use LIKE OR clauses (avoids Prisma array-binding quirks; safe with
  // hard-coded constant names).
  const conds = INDEX_NAMES.map(
    (n) => `indexname = '${n.replace(/'/g, "''")}'`,
  ).join(" OR ");
  const sql = `SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'Story' AND (${conds})
    ORDER BY indexname`;
  const rows = await p.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(sql);

  const found = new Set(rows.map((r) => r.indexname));
  let allOk = true;
  console.log("\n=== Composite indexes on Story (Supabase) ===");
  for (const name of INDEX_NAMES) {
    const present = found.has(name);
    console.log(`  ${present ? "OK " : "MISSING"}  ${name}`);
    if (!present) allOk = false;
  }

  console.log("\nResult:", allOk ? "all 6 present" : "MISSING some");
  process.exitCode = allOk ? 0 : 1;
}

main().finally(() => p.$disconnect());