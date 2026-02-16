import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { compressBase64Image } from "../lib/compressImage";
import { cached, SHORT_TTL } from "../lib/cache";

const router = Router();

// GET /api/stories — list stories with optional filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const { genre, status, search, sort = "updatedAt", page = "1", limit = "20" } = req.query;

    const where: any = { approvalStatus: "approved" };
    if (genre) where.genre = genre as string;
    if (status) where.status = status as string;
    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: "insensitive" } },
        { description: { contains: search as string, mode: "insensitive" } },
        { author: { name: { contains: search as string, mode: "insensitive" } } },
      ];
    }

    const orderBy: any = {};
    if (sort === "views") orderBy.views = "desc";
    else if (sort === "likes") orderBy.likes = "desc";
    else orderBy.updatedAt = "desc";

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const cacheKey = `stories:${genre || ""}:${status || ""}:${search || ""}:${sort}:${pageNum}:${limitNum}`;

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
            _count: { select: { chapters: true, bookmarks: true } },
          },
        }),
        prisma.story.count({ where }),
      ]);

      return {
        stories,
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
      select: { coverImage: true, approvalStatus: true },
    });
    if (!story?.coverImage) return res.status(404).end();

    // Only serve covers for approved stories
    if (story.approvalStatus !== "approved") return res.status(403).end();

    // If coverImage is a URL (cloud storage), redirect to it
    if (story.coverImage.startsWith("http://") || story.coverImage.startsWith("https://")) {
      return res.redirect(301, story.coverImage);
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
