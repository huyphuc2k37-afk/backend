import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { compressBase64Image } from "../lib/compressImage";
import { cached, SHORT_TTL } from "../lib/cache";

const router = Router();

// GET /api/stories — list stories with optional filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      genre, category, tags: tagSlugs,
      status, search, sort = "updatedAt",
      page = "1", limit = "20",
      is_paid, is_adult,
    } = req.query;

    const where: any = { approvalStatus: "approved" };
    if (genre) {
      // Match stories where the genre field contains the name (exact or as part of comma-separated list)
      // OR there's a matching StoryTag (type=genre) with that name.
      const genreName = genre as string;
      where.OR = [
        { genre: { contains: genreName, mode: "insensitive" } },
        { storyTags: { some: { tag: { name: { equals: genreName, mode: "insensitive" }, type: "genre" } } } },
      ];
    }
    if (category) {
      where.category = { slug: category as string };
    }
    if (tagSlugs) {
      const slugs = (tagSlugs as string).split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10);
      if (slugs.length > 0) {
        // When genre filter already added an OR with storyTags, we need AND for tag filter
        if (where.storyTags) {
          where.AND = [...(where.AND || []), { storyTags: { some: { tag: { slug: { in: slugs } } } } }];
        } else {
          where.storyTags = { some: { tag: { slug: { in: slugs } } } };
        }
      }
    }
    if (status) where.status = status as string;
    if (is_paid === "true") where.chapters = { some: { isLocked: true } };
    if (is_paid === "false") where.chapters = { none: { isLocked: true } };
    if (is_adult === "true") where.isAdult = true;
    if (is_adult === "false") where.isAdult = false;
    if (search) {
      const searchOR = [
        { title: { contains: search as string, mode: "insensitive" } },
        { description: { contains: search as string, mode: "insensitive" } },
        { author: { name: { contains: search as string, mode: "insensitive" } } },
      ];
      // If genre already used where.OR, wrap search in AND to avoid overwriting
      if (where.OR) {
        where.AND = [...(where.AND || []), { OR: searchOR }];
      } else {
        where.OR = searchOR;
      }
    }

    const orderBy: any = {};
    if (sort === "views") orderBy.views = "desc";
    else if (sort === "likes" || sort === "popular") orderBy.likes = "desc";
    else if (sort === "new") orderBy.createdAt = "desc";
    else orderBy.updatedAt = "desc";

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const cacheKey = `stories:${genre || ""}:${category || ""}:${tagSlugs || ""}:${status || ""}:${search || ""}:${sort}:${pageNum}:${limitNum}:${is_paid || ""}:${is_adult || ""}`;

    const result = await cached(cacheKey, SHORT_TTL, async () => {
      const [stories, total] = await Promise.all([
        prisma.story.findMany({
          where,
          orderBy,
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
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
        stories: stories.map((s) => ({
          ...s,
          storyTagList: s.storyTags.map((st) => st.tag),
          storyTags: undefined,
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      };
    });

    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json(result);
  } catch (error) {
    console.error("Error fetching stories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/stories/:id/cover — serve cover image (cloud URL redirect or base64 binary)
router.get("/:id/cover", async (req: Request, res: Response) => {
  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id },
      select: { coverImage: true, approvalStatus: true, coverApprovalStatus: true },
    });
    if (!story?.coverImage) return res.status(404).end();

    // Serve cover logic:
    // - Approved story: always serve cover UNLESS cover was explicitly rejected
    // - Pending/other story: serve only if cover itself was approved
    const coverRejected = story.coverApprovalStatus === "rejected";
    const coverOk = story.approvalStatus === "approved"
      ? !coverRejected
      : story.coverApprovalStatus === "approved";
    if (!coverOk) return res.status(403).end();

    // If coverImage is a URL (cloud storage), redirect (302 so browser doesn't cache permanently)
    if (story.coverImage.startsWith("http://") || story.coverImage.startsWith("https://")) {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.redirect(302, story.coverImage);
    }

    // Legacy: base64 data URI — serve as binary
    const match = story.coverImage.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!match) return res.status(404).end();

    const [, mimeType, base64Data] = match;
    const buffer = Buffer.from(base64Data, "base64");

    res.set("Content-Type", mimeType);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch {
    res.status(500).end();
  }
});

export default router;
