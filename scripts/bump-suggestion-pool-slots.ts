// Bump existing SuggestionPool.slots from 5 to 10.
// This is the featured-pool capacity for the "Đề cử 50 xu" feature.
// Idempotent: only updates pools with slots < 10.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL!;
if (url.includes("127.0.0.1") || url.includes("localhost")) {
  console.error("REFUSING: localhost URL");
  process.exit(2);
}

const p = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const pools = await p.suggestionPool.findMany({
    orderBy: { date: "desc" },
  });
  console.log(`Pools found: ${pools.length}`);
  for (const pool of pools) {
    console.log(`  ${pool.date.toISOString().split("T")[0]}: slots=${pool.slots}`);
    if (pool.slots < 10) {
      await p.suggestionPool.update({
        where: { date: pool.date },
        data: { slots: 10 },
      });
      console.log(`    -> bumped to 10`);
    }
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error("Failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());