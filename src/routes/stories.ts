import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { compressBase64Image } from "../lib/compressImage";

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
        { title: { contains: search as string } },
        { description: { contains: search as string } },
      ];
    }

    const orderBy: any = {};
    if (sort === "views") orderBy.views = "desc";
    else if (sort === "likes") orderBy.likes = "desc";
    else orderBy.updatedAt = "desc";

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

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

    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json({
      stories,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error fetching stories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/stories/:id/cover — serve cover image as binary with caching
router.get("/:id/cover", async (req: Request, res: Response) => {
  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id },
      select: { coverImage: true },
    });
    if (!story?.coverImage) return res.status(404).end();

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
