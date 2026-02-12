import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET /api/stories/:slug — get single story detail
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const story = await prisma.story.findUnique({
      where: { slug },
      include: {
        author: { select: { id: true, name: true, image: true, bio: true } },
        chapters: {
          select: { id: true, title: true, number: true, wordCount: true, createdAt: true },
          orderBy: { number: "asc" },
        },
        _count: { select: { bookmarks: true, comments: true } },
      },
    });

    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }

    // Increment views
    await prisma.story.update({
      where: { slug },
      data: { views: { increment: 1 } },
    });

    res.json(story);
  } catch (error) {
    console.error("Error fetching story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
