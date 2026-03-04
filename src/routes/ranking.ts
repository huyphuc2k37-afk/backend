import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { cached, MEDIUM_TTL } from "../lib/cache";

const router = Router();

/** Derive a direct cover URL from a Story record */
function deriveCoverUrl(story: { coverImage?: string | null; coverApprovalStatus?: string; approvalStatus?: string }): string | null {
  if (!story.coverImage) return null;
  if (story.coverApprovalStatus === "rejected") return null;
  if (story.approvalStatus !== "approved" && story.coverApprovalStatus !== "approved") return null;
  if (story.coverImage.startsWith("http://") || story.coverImage.startsWith("https://")) {
    return story.coverImage;
  }
  return null;
}

// GET /api/ranking — top stories
router.get("/", async (req: Request, res: Response) => {
  try {
    const { sort = "views", limit = "20" } = req.query;
    const take = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const cacheKey = `ranking:${sort}:${take}`;

    const stories = await cached(cacheKey, MEDIUM_TTL, async () => {
      let orderBy: any;
      if (sort === "likes") orderBy = { likes: "desc" };
      else if (sort === "rating") orderBy = { averageRating: "desc" };
      else if (sort === "new") orderBy = { createdAt: "desc" };
      else orderBy = { views: "desc" };

      return prisma.story.findMany({
        where: { approvalStatus: "approved" },
        orderBy,
        take,
        select: {
          id: true,
          title: true,
          slug: true,
          genre: true,
          status: true,
          views: true,
          likes: true,
          averageRating: true,
          ratingCount: true,
          createdAt: true,
          updatedAt: true,
          coverImage: true,
          coverApprovalStatus: true,
          approvalStatus: true,
          author: { select: { id: true, name: true, image: true } },
          _count: { select: { chapters: true } },
        },
      });
    });

    // Map to include coverUrl and strip raw cover fields
    const mapped = stories.map((s: any) => {
      const { coverImage, coverApprovalStatus, approvalStatus, ...rest } = s;
      return { ...rest, coverUrl: deriveCoverUrl(s) };
    });

    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    res.json(mapped);
  } catch (error) {
    console.error("Error fetching ranking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
