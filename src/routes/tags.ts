import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { cached, SHORT_TTL, LONG_TTL } from "../lib/cache";

const router = Router();

// ─── GET /api/tags — list all tags (optionally filtered by type) ──
router.get("/", async (req: Request, res: Response) => {
  try {
    const { type } = req.query;

    const cacheKey = `tags:${type || "all"}`;
    const result = await cached(cacheKey, LONG_TTL, async () => {
      const where: any = {};
      if (type && typeof type === "string") {
        where.type = type;
      }

      const tags = await prisma.tag.findMany({
        where,
        orderBy: [{ type: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          _count: { select: { storyTags: true } },
        },
      });

      // Group by type
      const grouped: Record<string, any[]> = {};
      for (const tag of tags) {
        if (!grouped[tag.type]) grouped[tag.type] = [];
        grouped[tag.type].push({
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          type: tag.type,
          storyCount: tag._count.storyTags,
        });
      }

      return { tags: grouped };
    });

    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.json(result);
  } catch (error) {
    console.error("Error fetching tags:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/tags/:slug — tag detail with stories ──
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const {
      page = "1",
      pageSize = "20",
      sort = "updated",
      status,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const pageSizeNum = Math.min(60, Math.max(1, parseInt(pageSize as string) || 20));

    const cacheKey = `tag:${slug}:${page}:${pageSize}:${sort}:${status || ""}`;

    const result = await cached(cacheKey, SHORT_TTL, async () => {
      const tag = await prisma.tag.findUnique({
        where: { slug },
        select: { id: true, name: true, slug: true, type: true },
      });

      if (!tag) return null;

      const where: any = {
        approvalStatus: "approved",
        storyTags: { some: { tagId: tag.id } },
      };

      if (status && ["ongoing", "completed"].includes(status as string)) {
        where.status = status as string;
      }

      let orderBy: any;
      switch (sort) {
        case "views": orderBy = { views: "desc" }; break;
        case "popular": orderBy = { likes: "desc" }; break;
        case "new": orderBy = { createdAt: "desc" }; break;
        default: orderBy = { updatedAt: "desc" };
      }

      const [stories, total] = await Promise.all([
        prisma.story.findMany({
          where,
          orderBy,
          skip: (pageNum - 1) * pageSizeNum,
          take: pageSizeNum,
          select: {
            id: true,
            title: true,
            slug: true,
            description: true,
            genre: true,
            status: true,
            views: true,
            likes: true,
            isAdult: true,
            createdAt: true,
            updatedAt: true,
            author: { select: { id: true, name: true, image: true } },
            category: { select: { name: true, slug: true } },
            _count: { select: { chapters: true, bookmarks: true } },
            storyTags: {
              select: { tag: { select: { name: true, slug: true, type: true } } },
            },
          },
        }),
        prisma.story.count({ where }),
      ]);

      return {
        tag,
        stories: stories.map((s) => ({
          ...s,
          tags: s.storyTags.map((st) => st.tag),
          storyTags: undefined,
        })),
        pagination: {
          page: pageNum,
          pageSize: pageSizeNum,
          total,
          totalPages: Math.ceil(total / pageSizeNum),
        },
      };
    });

    if (!result) {
      return res.status(404).json({ error: "Tag not found" });
    }

    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json(result);
  } catch (error) {
    console.error("Error fetching tag stories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
