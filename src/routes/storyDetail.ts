import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { cached, SHORT_TTL } from "../lib/cache";

const router = Router();

// Simple in-memory view dedup: 1 view per IP per story per hour
const viewedRecently = new Map<string, number>();
const VIEW_COOLDOWN = 60 * 60 * 1000; // 1 hour
// Cleanup every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of viewedRecently) {
    if (now - ts > VIEW_COOLDOWN) viewedRecently.delete(key);
  }
}, 30 * 60 * 1000);

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

    // Fire-and-forget view increment (with IP dedup)
    const viewerIp = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const viewKey = `${viewerIp}:${slug}`;
    const lastViewed = viewedRecently.get(viewKey);
    if (!lastViewed || Date.now() - lastViewed > VIEW_COOLDOWN) {
      viewedRecently.set(viewKey, Date.now());
      prisma.story.update({
        where: { slug },
        data: { views: { increment: 1 } },
      }).catch(() => {});
    }

    res.json(story);
  } catch (error) {
    console.error("Error fetching story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
