/**
 * Migration Script: Convert base64 cover images to Supabase Storage URLs.
 *
 * This migrates all stories that still have base64 data URIs as their
 * coverImage to cloud storage on Supabase, reducing database size.
 *
 * Usage:
 *   npx ts-node scripts/migrate-covers.ts                 # dry run
 *   npx ts-node scripts/migrate-covers.ts --execute       # actually migrate
 *
 * Requires env vars:
 *   DATABASE_URL
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const prisma = new PrismaClient();
const BUCKET = "covers";

const isDryRun = !process.argv.includes("--execute");

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  VStory — Cover Image Migration (base64 → Cloud)");
  console.log("═══════════════════════════════════════════════════");
  console.log(`Mode: ${isDryRun ? "🔍 DRY RUN (no changes)" : "🚀 EXECUTE (will migrate)"}`);
  console.log();

  // Validate env
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Find all stories with base64 cover images
  const stories = await prisma.story.findMany({
    where: {
      coverImage: { startsWith: "data:image" },
    },
    select: {
      id: true,
      title: true,
      slug: true,
      coverImage: true,
    },
  });

  console.log(`📊 Found ${stories.length} stories with base64 cover images\n`);

  if (stories.length === 0) {
    console.log("✅ Nothing to migrate — all covers are already on cloud storage!");
    await prisma.$disconnect();
    return;
  }

  // Calculate total base64 size
  const totalBase64Bytes = stories.reduce(
    (sum, s) => sum + (s.coverImage?.length || 0),
    0
  );
  console.log(`💾 Total base64 data in DB: ${(totalBase64Bytes / 1024 / 1024).toFixed(2)} MB\n`);

  let migrated = 0;
  let failed = 0;
  let skipped = 0;

  for (const story of stories) {
    const dataUri = story.coverImage!;
    const match = dataUri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);

    if (!match) {
      console.log(`  ⚠️  [${story.id}] "${story.title}" — invalid data URI, skipping`);
      skipped++;
      continue;
    }

    const [, mimeType, base64Data] = match;
    const buffer = Buffer.from(base64Data, "base64");

    const ext =
      mimeType === "image/webp"
        ? "webp"
        : mimeType === "image/png"
          ? "png"
          : mimeType === "image/gif"
            ? "gif"
            : "jpg";

    const hash = crypto.createHash("md5").update(buffer).digest("hex").slice(0, 8);
    const path = `${story.id}/${hash}.${ext}`;

    const sizeKB = (buffer.length / 1024).toFixed(1);

    if (isDryRun) {
      console.log(`  📷 [DRY] "${story.title}" — ${sizeKB} KB → covers/${path}`);
      migrated++;
      continue;
    }

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mimeType,
      upsert: true,
      cacheControl: "public, max-age=31536000",
    });

    if (uploadError) {
      console.error(`  ❌ [${story.id}] "${story.title}" — upload failed: ${uploadError.message}`);
      failed++;
      continue;
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = urlData?.publicUrl;

    if (!publicUrl) {
      console.error(`  ❌ [${story.id}] "${story.title}" — failed to get public URL`);
      failed++;
      continue;
    }

    // Update DB record
    await prisma.story.update({
      where: { id: story.id },
      data: { coverImage: publicUrl },
    });

    console.log(`  ✅ "${story.title}" — ${sizeKB} KB → ${publicUrl}`);
    migrated++;
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Migration Summary");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Total stories with base64:  ${stories.length}`);
  console.log(`  Migrated:                   ${migrated}`);
  console.log(`  Failed:                     ${failed}`);
  console.log(`  Skipped:                    ${skipped}`);
  console.log(`  DB size freed:              ~${(totalBase64Bytes / 1024 / 1024).toFixed(2)} MB`);

  if (isDryRun) {
    console.log("\n  💡 This was a DRY RUN. Run with --execute to actually migrate:");
    console.log("     npx ts-node scripts/migrate-covers.ts --execute");
  } else {
    console.log("\n  🎉 Migration complete!");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
