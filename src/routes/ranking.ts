import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { cached, MEDIUM_TTL } from "../lib/cache";
import { deriveCoverUrl } from "../lib/cover";

const router = Router();

// (deriveCoverUrl is imported from ../lib/cover; see that file for the canonical logic)

// GET /api/ranking — top stories
// B2: Hỗ trợ period=week|month|all, mặc định "all" (backward-compat)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { sort = "views", limit = "20", period = "all" } = req.query;
    const take = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const cacheKey = `ranking:${sort}:${period}:${take}`;

    const stories = await cached(cacheKey, MEDIUM_TTL, async () => {
      let orderBy: any;
      if (sort === "likes") orderBy = { likes: "desc" };
      else if (sort === "rating") orderBy = { averageRating: "desc" };
      else if (sort === "new") orderBy = { createdAt: "desc" };
      else orderBy = { views: "desc" };

      // B2: Nếu period = week hoặc month → lấy view count từ ViewLog trong khoảng thời gian
      if (period === "week" || period === "month") {
        const days = period === "week" ? 7 : 30;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const recentViews = await prisma.viewLog.groupBy({
          by: ["storyId"],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
          orderBy: { _count: { storyId: "desc" } },
          take,
        });

        const storyIds = recentViews.map((v) => v.storyId);
        const storiesData = await prisma.story.findMany({
          where: { id: { in: storyIds }, approvalStatus: "approved" },
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
        // Map period views vào story
        const viewsMap = new Map(recentViews.map((v) => [v.storyId, v._count._all]));
        const enriched = storiesData
          .map((s) => ({ ...s, periodViews: viewsMap.get(s.id) || 0 }))
          .sort((a, b) => b.periodViews - a.periodViews);
        return enriched;
      }

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
