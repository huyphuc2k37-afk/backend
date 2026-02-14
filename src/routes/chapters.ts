import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authOptional } from "../middleware/auth";

const router = Router();

// GET /api/chapters/:id — get chapter content
// Free chapters: accessible to everyone
// Locked chapters: require auth + purchase (or be the author)
router.get("/:id", authOptional, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const chapter = await prisma.chapter.findUnique({
      where: { id },
      include: {
        story: {
          select: { id: true, title: true, slug: true, authorId: true, isAdult: true, genre: true, approvalStatus: true },
        },
        _count: { select: { comments: true } },
      },
    });

    if (!chapter) {
      return res.status(404).json({ error: "Chapter not found" });
    }

    // Block access to chapters of unapproved stories
    if (chapter.story.approvalStatus !== "approved") {
      return res.status(403).json({ error: "Truyện chưa được duyệt" });
    }

    // Block access to unapproved chapters (allow author to still see their own)
    if (chapter.approvalStatus !== "approved") {
      // Check if current user is the author
      const isAuthor = req.user?.email
        ? await prisma.user.findUnique({ where: { email: req.user.email }, select: { id: true } })
            .then((u) => u?.id === chapter.story.authorId)
        : false;
      if (!isAuthor) {
        return res.status(403).json({ error: "Chương chưa được duyệt" });
      }
    }

    // Get prev/next approved chapters
    const [prev, next] = await Promise.all([
      prisma.chapter.findFirst({
        where: { storyId: chapter.storyId, number: { lt: chapter.number }, approvalStatus: "approved" },
        orderBy: { number: "desc" },
        select: { id: true, title: true, number: true },
      }),
      prisma.chapter.findFirst({
        where: { storyId: chapter.storyId, number: { gt: chapter.number }, approvalStatus: "approved" },
        orderBy: { number: "asc" },
        select: { id: true, title: true, number: true },
      }),
    ]);

    // If chapter is free, return full content to everyone
    if (!chapter.isLocked || chapter.price === 0) {
      return res.json({ ...chapter, prev, next });
    }

    // ─── Locked chapter: check auth + purchase ───
    if (!req.user) {
      // Not logged in — return chapter metadata without content
      return res.json({
        ...chapter,
        content: "",
        prev,
        next,
        requiresLogin: true,
      });
    }

    // Get user from DB
    const user = await prisma.user.findUnique({
      where: { email: req.user.email },
      select: { id: true },
    });
    if (!user) {
      return res.json({ ...chapter, content: "", prev, next, requiresLogin: true });
    }

    // Author can always read their own chapters
    if (user.id === chapter.story.authorId) {
      return res.json({ ...chapter, prev, next });
    }

    // Check if user has purchased this chapter
    const purchase = await prisma.chapterPurchase.findUnique({
      where: { userId_chapterId: { userId: user.id, chapterId: chapter.id } },
    });

    if (purchase) {
      // Already purchased — return full content
      return res.json({ ...chapter, prev, next });
    }

    // Not purchased — return metadata without content
    return res.json({
      ...chapter,
      content: "",
      prev,
      next,
      requiresPurchase: true,
    });
  } catch (error) {
    console.error("Error fetching chapter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
