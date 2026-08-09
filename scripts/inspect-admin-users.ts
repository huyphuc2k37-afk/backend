// Look for users with duplicate emails or duplicate slugs that could
// cause role/identity confusion. Also dump admin users so we can
// cross-check role stability.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL!;
const p = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("=== Admin users (full row) ===");
  const admins = await p.user.findMany({
    where: { role: "admin" },
    select: {
      id: true,
      email: true,
      name: true,
      provider: true,
      role: true,
      emailVerified: true,
      createdAt: true,
      updatedAt: true,
      image: true,
    },
    orderBy: { createdAt: "asc" },
  });
  for (const a of admins) {
    console.log(JSON.stringify(a, null, 2));
  }

  console.log("\n=== Duplicate emails (case-insensitive) ===");
  const all = await p.user.findMany({
    select: { id: true, email: true, role: true, provider: true, createdAt: true },
    orderBy: { email: "asc" },
  });
  const map = new Map<string, typeof all>();
  for (const u of all) {
    const key = u.email.toLowerCase();
    const arr = map.get(key) || [];
    arr.push(u);
    map.set(key, arr);
  }
  for (const [email, users] of map.entries()) {
    if (users.length > 1) {
      console.log(`\n!! ${email} has ${users.length} rows:`);
      for (const u of users) console.log(`   ${u.id} role=${u.role} provider=${u.provider} created=${u.createdAt.toISOString()}`);
    }
  }

  console.log("\n=== Email-like-name mismatch (Google sync possible duplicates) ===");
  for (const u of all) {
    if (!u.email.endsWith("@gmail.com")) continue;
    const local = u.email.split("@")[0].replace(/\./g, "");
    const normEmail = `${local}@gmail.com`;
    if (normEmail !== u.email) {
      console.log(`!! Un-normalized: stored="${u.email}" normalized="${normEmail}" (role=${u.role})`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => p.$disconnect());