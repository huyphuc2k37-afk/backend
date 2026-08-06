/**
 * Generate placeholder covers for stories that don't have coverImage.
 * Uses a text-based SVG placeholder with story title.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Generate Placeholder Covers ===\n");

  // Find stories without coverImage
  const stories = await prisma.story.findMany({
    where: {
      approvalStatus: "approved",
      coverImage: null,
    },
    select: {
      id: true,
      title: true,
      author: { select: { name: true } },
    },
    take: 100,
  });

  console.log(`Found ${stories.length} approved stories without covers`);

  for (const story of stories) {
    // Generate a simple SVG placeholder
    const title = story.title || "Untitled";
    const author = story.author?.name || "Unknown";
    
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="300" height="400" fill="url(#bg)"/>
  <text x="150" y="150" font-family="Arial, sans-serif" font-size="20" fill="white" text-anchor="middle" font-weight="bold">${escapeXml(title)}</text>
  <text x="150" y="180" font-family="Arial, sans-serif" font-size="14" fill="white" text-anchor="middle" opacity="0.8">by ${escapeXml(author)}</text>
  <text x="150" y="350" font-family="Arial, sans-serif" font-size="12" fill="white" text-anchor="middle" opacity="0.6">VStory</text>
</svg>`;

    const encoded = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);

    await prisma.story.update({
      where: { id: story.id },
      data: {
        coverImage: encoded,
        coverApprovalStatus: "approved",
      },
    });

    console.log(`Updated: ${title}`);
  }

  console.log("\nDone!");
  await prisma.$disconnect();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

main().catch(console.error);
