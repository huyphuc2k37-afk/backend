import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET /api/ranking — top stories
router.get("/", async (req: Request, res: Response) => {
  try {
    const { sort = "views", limit = "20" } = req.query;

    const orderBy: any = sort === "likes" ? { likes: "desc" } : { views: "desc" };

    const stories = await prisma.story.findMany({
      orderBy,
      take: parseInt(limit as string),
      select: {
        id: true,
        title: true,
        slug: true,
        genre: true,
        status: true,
        views: true,
        likes: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, name: true, image: true } },
        _count: { select: { chapters: true } },
      },
    });

    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    res.json(stories);
  } catch (error) {
    console.error("Error fetching ranking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
