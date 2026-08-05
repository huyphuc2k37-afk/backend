/**
 * DEPRECATED — DO NOT RUN.
 *
 * This script was executed on 2026-04-25 and silently overwrote the
 * `coverImage` column of 191 stories with an inline SVG placeholder. The
 * original Supabase URLs were lost because the project's egress quota was
 * already exhausted and the storage URLs could not be re-fetched.
 *
 * It has been kept around for archaeological reference only. The fix is
 * in `scripts/restore-supabase-covers.ts` (Cloudinary-first) and
 * `scripts/migrate-inline-covers.ts`. See `docs/INCIDENT_2026-04-25.md`
 * for the full timeline and lessons learned.
 *
 * Before re-enabling this file, you MUST:
 *   1. Read docs/INCIDENT_2026-04-25.md
 *   2. Confirm the upstream URLs are still alive (HEAD-check)
 *   3. Add a snapshot backup keyed off BOTH `coverImage` and `updatedAt`
 *      so a re-run can detect and refuse to overwrite a recently-restored row
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

const palettes = [
  { bg: "#0f172a", fg: "#f8fafc", accent: "#38bdf8" },
  { bg: "#1f2937", fg: "#f9fafb", accent: "#f59e0b" },
  { bg: "#111827", fg: "#e5e7eb", accent: "#22c55e" },
  { bg: "#312e81", fg: "#eef2ff", accent: "#60a5fa" },
  { bg: "#3f1d2e", fg: "#fdf2f8", accent: "#f472b6" },
  { bg: "#0c4a6e", fg: "#ecfeff", accent: "#22d3ee" },
];

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateTitle(title: string, max = 34): string {
  const t = title.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function makeFallbackSvg(title: string, storyId: string): string {
  const palette = palettes[hashString(storyId) % palettes.length];
  const safeTitle = escapeXml(truncateTitle(title || "VStory"));

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bg}" />
      <stop offset="100%" stop-color="#000000" />
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#bg)" />
  <rect x="36" y="36" width="528" height="728" rx="24" fill="none" stroke="${palette.accent}" stroke-opacity="0.45" stroke-width="3" />
  <rect x="70" y="560" width="460" height="2" fill="${palette.accent}" fill-opacity="0.55" />
  <text x="70" y="620" fill="${palette.fg}" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700">${safeTitle}</text>
  <text x="70" y="684" fill="${palette.accent}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="600">VStory</text>
</svg>`.trim();
}

function toSvgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function main() {
  const stories = await prisma.story.findMany({
    where: { coverImage: { contains: "supabase.co/storage/" } },
    select: { id: true, title: true, coverImage: true },
    orderBy: { updatedAt: "desc" },
  });

  if (stories.length === 0) {
    console.log("No Supabase cover URLs found. Nothing to repair.");
    return;
  }

  const backup = {
    generatedAt: new Date().toISOString(),
    total: stories.length,
    stories,
  };

  const backupPath = path.join(
    process.cwd(),
    "backups",
    `cover_url_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
  console.log(`Backup saved: ${backupPath}`);

  let updated = 0;
  for (const s of stories) {
    const svg = makeFallbackSvg(s.title, s.id);
    const dataUri = toSvgDataUri(svg);
    await prisma.story.update({
      where: { id: s.id },
      data: { coverImage: dataUri },
    });
    updated++;
    if (updated % 50 === 0) {
      console.log(`Updated ${updated}/${stories.length} covers...`);
    }
  }

  console.log(`Done. Repaired ${updated} stories.`);
}

main()
  .catch((error) => {
    console.error("repair-supabase-covers failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
