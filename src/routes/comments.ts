import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// GET /api/comments?storyId=xxx&chapterId=xxx — get comments for a story or chapter
router.get("/", async (req: Request, res: Response) => {
  try {
    const { storyId, chapterId, page = "1" } = req.query;
    if (!storyId && !chapterId) {
      return res.status(400).json({ error: "storyId or chapterId is required" });
    }

    const pageNum = parseInt(page as string) || 1;
    const limit = 30;
    const where: any = {};
    if (chapterId) {
      where.chapterId = chapterId as string;
    } else {
      where.storyId = storyId as string;
      where.chapterId = null; // story-level comments only
    }

    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, image: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limit,
        take: limit,
      }),
      prisma.comment.count({ where }),
    ]);

    res.json({ comments, total });
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/comments — create a comment (auth required)
router.post("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { storyId, chapterId, content } = req.body;
    if (!content?.trim()) {
      return res.status(400).json({ error: "Nội dung bình luận không được để trống" });
    }
    if (!storyId && !chapterId) {
      return res.status(400).json({ error: "storyId hoặc chapterId là bắt buộc" });
    }

    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // If chapterId provided, look up the storyId from the chapter
    let finalStoryId = storyId;
    if (chapterId) {
      const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { storyId: true } });
      if (!chapter) return res.status(404).json({ error: "Chapter not found" });
      finalStoryId = chapter.storyId;
    }

    const comment = await prisma.comment.create({
      data: {
        content: content.trim(),
        userId: user.id,
        storyId: finalStoryId,
        chapterId: chapterId || null,
      },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
    });

    // Notify author (fire-and-forget)
    prisma.story.findUnique({
      where: { id: finalStoryId },
      select: { authorId: true, title: true },
    }).then((story) => {
      if (story && story.authorId !== user.id) {
        prisma.notification.create({
          data: {
            userId: story.authorId,
            title: "Bình luận mới",
            message: `${user.name} đã bình luận về truyện "${story.title}".`,
            type: "system",
            link: `/story/${finalStoryId}`,
          },
        }).catch(() => {});
      }
    }).catch(() => {});

    res.status(201).json(comment);
  } catch (error) {
    console.error("Error creating comment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/comments/:id — delete own comment (auth required)
router.delete("/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const comment = await prisma.comment.findUnique({ where: { id: req.params.id } });
    if (!comment) return res.status(404).json({ error: "Comment not found" });
    if (comment.userId !== user.id && user.role !== "admin") {
      return res.status(403).json({ error: "Không có quyền xóa bình luận này" });
    }

    await prisma.comment.delete({ where: { id: comment.id } });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
