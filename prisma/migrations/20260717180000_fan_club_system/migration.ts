import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Read the migration SQL file
  const migrationSql = fs.readFileSync(
    path.join(__dirname, "migration.sql"),
    "utf8"
  );

  // Execute the SQL migration
  await prisma.$executeRawUnsafe(migrationSql);

  console.log("Fan Club System migration completed successfully");
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
