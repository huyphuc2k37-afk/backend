import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// GET /api/bookmarks — get user's bookmarks
router.get("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: user.id },
      include: {
        story: {
          select: {
            id: true,
            title: true,
            slug: true,
            genre: true,
            status: true,
            views: true,
            author: { select: { id: true, name: true, image: true } },
            _count: { select: { chapters: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(bookmarks);
  } catch (error) {
    console.error("Error fetching bookmarks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/bookmarks — toggle bookmark
router.post("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { storyId } = req.body;

    const existing = await prisma.bookmark.findUnique({
      where: { userId_storyId: { userId: user.id, storyId } },
    });

    if (existing) {
      // Remove bookmark (toggle)
      await prisma.bookmark.delete({ where: { id: existing.id } });
      return res.json({ bookmarked: false });
    }

    await prisma.bookmark.create({
      data: { userId: user.id, storyId },
    });

    res.json({ bookmarked: true });
  } catch (error) {
    console.error("Error toggling bookmark:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
