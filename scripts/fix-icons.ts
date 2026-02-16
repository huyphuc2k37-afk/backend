import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function fix() {
  const map: Record<string, string> = {
    "HeartIcon": "💕",
    "SparklesIcon": "✨",
    "RocketLaunchIcon": "🚀",
    "ArrowPathIcon": "🔄",
    "FireIcon": "👻",
    "BuildingOffice2Icon": "🏫",
    "MagnifyingGlassIcon": "🔍",
    "BookOpenIcon": "📖",
  };
  for (const [old, emoji] of Object.entries(map)) {
    const r = await prisma.category.updateMany({ where: { icon: old }, data: { icon: emoji } });
    if (r.count > 0) console.log(`${old} -> ${emoji} (${r.count})`);
  }
  const cats = await prisma.category.findMany({
    select: { name: true, icon: true },
    orderBy: { displayOrder: "asc" },
  });
  cats.forEach((c) => console.log(`${c.icon} ${c.name}`));
  await prisma.$disconnect();
}

fix();
