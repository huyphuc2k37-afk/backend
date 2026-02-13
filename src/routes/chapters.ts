import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET /api/chapters/:id — get chapter content
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const chapter = await prisma.chapter.findUnique({
      where: { id },
      include: {
        story: {
          select: { id: true, title: true, slug: true, authorId: true },
        },
        _count: { select: { comments: true } },
      },
    });

    if (!chapter) {
      return res.status(404).json({ error: "Chapter not found" });
    }

    // Get prev/next chapters
    const [prev, next] = await Promise.all([
      prisma.chapter.findFirst({
        where: { storyId: chapter.storyId, number: chapter.number - 1 },
        select: { id: true, title: true, number: true },
      }),
      prisma.chapter.findFirst({
        where: { storyId: chapter.storyId, number: chapter.number + 1 },
        select: { id: true, title: true, number: true },
      }),
    ]);

    res.json({ ...chapter, prev, next });
  } catch (error) {
    console.error("Error fetching chapter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
