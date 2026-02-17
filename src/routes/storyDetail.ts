import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { cached, SHORT_TTL, invalidateCache } from "../lib/cache";

const router = Router();

// ─── In-memory view buffer for batch updates ────
// Instead of instantly incrementing DB, we buffer views and flush every 30 min
const viewBuffer = new Map<string, number>(); // storyId → count
const viewedRecently = new Map<string, number>(); // "ip:slug" → timestamp
const VIEW_COOLDOWN = 60 * 60 * 1000; // 1 view per IP per story per hour
const MAX_VIEW_MAP_SIZE = 50_000;

// Flush buffered views to DB every 30 minutes
setInterval(async () => {
  // Clean expired IP dedup entries
  const now = Date.now();
  for (const [key, ts] of viewedRecently) {
    if (now - ts > VIEW_COOLDOWN) viewedRecently.delete(key);
  }

  // Flush view buffer to DB
  if (viewBuffer.size === 0) return;
  const entries = Array.from(viewBuffer.entries());
  viewBuffer.clear();

  console.log(`🔄 Flushing ${entries.length} story view counts...`);
  for (const [storyId, count] of entries) {
    try {
      await prisma.story.update({
        where: { id: storyId },
        data: { views: { increment: count } },
      });
    } catch (err) {
      // Story might have been deleted
    }
  }
  // Invalidate ranking caches after view flush
  invalidateCache("ranking:*");
  console.log(`✅ View flush complete`);
}, 30 * 60 * 1000); // every 30 minutes

// GET /api/stories/:slug — get single story detail
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const story = await cached(`story:${slug}`, SHORT_TTL, () =>
      prisma.story.findUnique({
        where: { slug },
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          genre: true,
          tags: true,
          status: true,
          views: true,
          likes: true,
          averageRating: true,
          ratingCount: true,
          isAdult: true,
          approvalStatus: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, image: true, bio: true } },
          category: { select: { id: true, name: true, slug: true } },
          storyTags: {
            select: { tag: { select: { id: true, name: true, slug: true, type: true } } },
          },
          chapters: {
            where: { approvalStatus: "approved" },
            select: { id: true, title: true, number: true, wordCount: true, isLocked: true, price: true, createdAt: true },
            orderBy: { number: "asc" },
          },
          _count: { select: { bookmarks: true, comments: true, storyLikes: true } },
        },
      })
    );

    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }

    // Block public access to unapproved stories
    if (story.approvalStatus !== "approved") {
      return res.status(403).json({ error: "Truyện chưa được duyệt" });
    }

    // Buffer view increment (flushed every 30 min)
    const rawIp = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const viewerIp = typeof rawIp === "string" ? rawIp.split(",")[0].trim() : "unknown";
    const viewKey = `${viewerIp}:${slug}`;
    const lastViewed = viewedRecently.get(viewKey);
    if (!lastViewed || Date.now() - lastViewed > VIEW_COOLDOWN) {
      if (viewedRecently.size >= MAX_VIEW_MAP_SIZE) {
        const oldest = viewedRecently.keys().next().value;
        if (oldest) viewedRecently.delete(oldest);
      }
      viewedRecently.set(viewKey, Date.now());
      // Add to buffer instead of direct DB write
      viewBuffer.set(story.id, (viewBuffer.get(story.id) || 0) + 1);
      // Also log to ViewLog for analytics
      prisma.viewLog.create({
        data: { storyId: story.id, ip: viewerIp },
      }).catch(() => {});
    }

    // Flatten storyTags for cleaner response
    const { storyTags, ...rest } = story;
    res.json({
      ...rest,
      storyTagList: storyTags?.map((st: any) => st.tag) ?? [],
    });
  } catch (error) {
    console.error("Error fetching story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
