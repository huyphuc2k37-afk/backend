import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET /api/stories — list stories with optional filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const { genre, status, search, sort = "updatedAt", page = "1", limit = "20" } = req.query;

    const where: any = {};
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
        include: {
          author: { select: { id: true, name: true, image: true } },
          _count: { select: { chapters: true, bookmarks: true } },
        },
      }),
      prisma.story.count({ where }),
    ]);

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

// POST /api/stories — create a new story
router.post("/", async (req: Request, res: Response) => {
  try {
    const { title, slug, description, coverImage, genre, tags, authorEmail } = req.body;

    if (!title || !slug || !description || !genre || !authorEmail) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const author = await prisma.user.findUnique({ where: { email: authorEmail } });
    if (!author) {
      return res.status(404).json({ error: "Author not found" });
    }

    const story = await prisma.story.create({
      data: {
        title,
        slug,
        description,
        coverImage,
        genre,
        tags,
        authorId: author.id,
      },
      include: {
        author: { select: { id: true, name: true, image: true } },
      },
    });

    res.status(201).json(story);
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Slug already exists" });
    }
    console.error("Error creating story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
