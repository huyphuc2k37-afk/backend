// Fill featured slots 6..10 with top-viewed approved stories that don't
// already have a slot. Idempotent: skips slots that are already occupied.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL!;
if (url.includes("127.0.0.1") || url.includes("localhost")) {
  console.error("REFUSING: localhost URL");
  process.exit(2);
}

const p = new PrismaClient({ datasources: { db: { url } } });
const TARGET_SLOTS = [6, 7, 8, 9, 10];

async function main() {
  // Show current slots
  const existing = await p.story.findMany({
    where: { featuredSlot: { not: null } },
    select: { featuredSlot: true, title: true },
    orderBy: { featuredSlot: "asc" },
  });
  console.log("Current featured slots:");
  for (const s of existing) console.log(`  ${s.featuredSlot}: ${s.title}`);

  const occupied = new Set(existing.map((s) => s.featuredSlot));
  const slotsToFill = TARGET_SLOTS.filter((n) => !occupied.has(n));
  console.log(`\nSlots to fill: ${slotsToFill.join(", ") || "(none)"}`);

  if (slotsToFill.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Find approved stories without a slot, ordered by views desc.
  const candidates = await p.story.findMany({
    where: { approvalStatus: "approved", featuredSlot: null },
    select: { id: true, title: true, views: true },
    orderBy: { views: "desc" },
    take: slotsToFill.length,
  });
  console.log(`\nCandidates (top views, no slot):`);
  for (const c of candidates) console.log(`  ${c.title} (views=${c.views})`);

  if (candidates.length < slotsToFill.length) {
    console.warn(
      `\nWARNING: only ${candidates.length} candidates but need ${slotsToFill.length}.`,
    );
  }

  for (let i = 0; i < Math.min(candidates.length, slotsToFill.length); i++) {
    const slot = slotsToFill[i];
    const c = candidates[i];
    await p.story.update({
      where: { id: c.id },
      data: { featuredSlot: slot },
    });
    console.log(`  slot=${slot} ← ${c.title}`);
  }

  console.log("\nDone. New featured count:",
    await p.story.count({ where: { featuredSlot: { not: null } } }),
  );
}

main()
  .catch((e) => {
    console.error("Failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());