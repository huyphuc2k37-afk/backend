// Seed additional GiftType rows. Idempotent: only inserts gifts whose name
// is not already present in the table. Uses DIRECT_URL, refuses localhost.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL not set");
  process.exit(1);
}
if (url.includes("127.0.0.1") || url.includes("localhost")) {
  console.error("REFUSING: localhost URL");
  process.exit(2);
}

const p = new PrismaClient({ datasources: { db: { url } } });

const NEW_GIFTS: Array<{
  name: string;
  emoji: string;
  price: number;
  sortOrder: number;
  animationUrl: string | null;
}> = [
  { name: "Trái tim",   emoji: "💖", price: 30,    sortOrder: 5,  animationUrl: null },
  { name: "Cà phê",     emoji: "☕", price: 80,    sortOrder: 6,  animationUrl: null },
  { name: "Hoa cúc",    emoji: "🌼", price: 200,   sortOrder: 8,  animationUrl: null },
  { name: "Bó hoa",     emoji: "💐", price: 500,   sortOrder: 9,  animationUrl: null },
  { name: "Bánh sinh nhật", emoji: "🎂", price: 50, sortOrder: 2,  animationUrl: null },
  { name: "Kẹo ngọt",   emoji: "🍬", price: 20,    sortOrder: 3,  animationUrl: null },
  { name: "Vương miện", emoji: "👑", price: 10000, sortOrder: 12, animationUrl: null },
  { name: "Kim cương",  emoji: "💎", price: 1000,  sortOrder: 10, animationUrl: null },
  { name: "Tên lửa",    emoji: "🚀", price: 2000,  sortOrder: 11, animationUrl: null },
  { name: "Cây thông",  emoji: "🎄", price: 300,   sortOrder: 13, animationUrl: null },
  { name: "Mèo con",    emoji: "🐱", price: 150,   sortOrder: 14, animationUrl: null },
  { name: "Trà sữa",    emoji: "🧋", price: 60,    sortOrder: 15, animationUrl: null },
];

async function main() {
  const conn = await p.$queryRaw<Array<{ db: string; host: string | null }>>`
    SELECT current_database() as db, inet_server_addr() as host
  `;
  console.log("Connected:", conn[0]);

  const existing = await p.giftType.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((g) => g.name));
  console.log("Existing gifts:", existing.length);

  let inserted = 0;
  let skipped = 0;
  for (const g of NEW_GIFTS) {
    if (existingNames.has(g.name)) {
      skipped++;
      continue;
    }
    await p.giftType.create({
      data: {
        name: g.name,
        emoji: g.emoji,
        price: g.price,
        sortOrder: g.sortOrder,
        animationUrl: g.animationUrl,
        isActive: true,
      },
    });
    console.log(`  + ${g.emoji} ${g.name} (${g.price} xu, sort=${g.sortOrder})`);
    inserted++;
  }

  const total = await p.giftType.count();
  console.log(`\nDone: ${inserted} inserted, ${skipped} already existed.`);
  console.log(`Total GiftType rows: ${total}`);
}

main()
  .catch((e) => {
    console.error("Failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());