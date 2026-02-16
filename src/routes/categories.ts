import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { cached, SHORT_TTL, MEDIUM_TTL, LONG_TTL } from "../lib/cache";

const router = Router();

// ─── GET /api/categories — list all categories ──
router.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await cached("categories:all", LONG_TTL, async () => {
      const categories = await prisma.category.findMany({
        orderBy: { displayOrder: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          seoTitle: true,
          seoDescription: true,
          icon: true,
          color: true,
          displayOrder: true,
          _count: { select: { stories: { where: { approvalStatus: "approved" } } } },
        },
      });

      return {
        categories: categories.map((c) => ({
          ...c,
          storyCount: c._count.stories,
          _count: undefined,
        })),
      };
    });

    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.json(result);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/categories/:slug — category detail with stories ──
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const {
      page = "1",
      pageSize = "20",
      sort = "updated",
      tags,
      status,
      is_paid,
      is_adult,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const pageSizeNum = Math.min(60, Math.max(1, parseInt(pageSize as string) || 20));

    const cacheKey = `cat:${slug}:${page}:${pageSize}:${sort}:${tags || ""}:${status || ""}:${is_paid || ""}:${is_adult || ""}`;

    const result = await cached(cacheKey, SHORT_TTL, async () => {
      // Find category
      const category = await prisma.category.findUnique({
        where: { slug },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          seoTitle: true,
          seoDescription: true,
          icon: true,
          color: true,
        },
      });

      if (!category) return null;

      // Build story filter
      const where: any = {
        categoryId: category.id,
        approvalStatus: "approved",
      };

      if (status && ["ongoing", "completed", "paused"].includes(status as string)) {
        where.status = status as string;
      }
      if (is_paid === "true") where.chapters = { some: { isLocked: true } };
      if (is_paid === "false") where.chapters = { none: { isLocked: true } };
      if (is_adult === "true") where.isAdult = true;
      if (is_adult === "false") where.isAdult = false;

      // Tag filter: comma-separated tag slugs
      if (tags) {
        const tagSlugs = (tags as string).split(",").map((t) => t.trim()).filter(Boolean);
        if (tagSlugs.length > 0) {
          where.storyTags = {
            some: {
              tag: { slug: { in: tagSlugs } },
            },
          };
        }
      }

      // Sort
      let orderBy: any;
      switch (sort) {
        case "views":
          orderBy = { views: "desc" };
          break;
        case "popular":
          orderBy = { likes: "desc" };
          break;
        case "new":
          orderBy = { createdAt: "desc" };
          break;
        case "updated":
        default:
          orderBy = { updatedAt: "desc" };
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
            _count: { select: { chapters: true, bookmarks: true } },
            storyTags: {
              select: { tag: { select: { name: true, slug: true, type: true } } },
            },
          },
        }),
        prisma.story.count({ where }),
      ]);

      return {
        category,
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
      return res.status(404).json({ error: "Category not found" });
    }

    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json(result);
  } catch (error) {
    console.error("Error fetching category stories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
