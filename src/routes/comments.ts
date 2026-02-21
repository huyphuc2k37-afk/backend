import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ── Quest helper: auto-complete comment quest ──
async function completeCommentQuest(userId: string) {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const date = vn.toISOString().slice(0, 10);

  const quest = await prisma.dailyQuest.upsert({
    where: { userId_date: { userId, date } },
    create: { id: require("crypto").randomUUID(), userId, date, commented: true, coinsEarned: 10 },
    update: {},
  });

  if (quest.commented) return; // already completed today
  if (quest.coinsEarned + 10 > 50) return; // daily limit

  await prisma.$transaction([
    prisma.dailyQuest.update({
      where: { userId_date: { userId, date } },
      data: { commented: true, coinsEarned: { increment: 10 } },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { coinBalance: { increment: 10 } },
    }),
  ]);
}

const userSelect = {
  id: true,
  name: true,
  image: true,
  role: true,
};

// GET /api/comments?storyId=xxx&chapterId=xxx — get comments (with replies nested)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { storyId, chapterId, page = "1" } = req.query;
    if (!storyId && !chapterId) {
      return res.status(400).json({ error: "storyId or chapterId is required" });
    }

    const pageNum = parseInt(page as string) || 1;
    const limit = 30;
    const where: any = { parentId: null }; // top-level only
    if (chapterId) {
      where.chapterId = chapterId as string;
    } else {
      where.storyId = storyId as string;
      where.chapterId = null;
    }

    // Find story authorId for "author" badge
    let storyAuthorId: string | null = null;
    if (storyId) {
      const story = await prisma.story.findUnique({
        where: { id: storyId as string },
        select: { authorId: true },
      });
      storyAuthorId = story?.authorId || null;
    } else if (chapterId) {
      const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId as string },
        select: { story: { select: { authorId: true } } },
      });
      storyAuthorId = chapter?.story?.authorId || null;
    }

    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        where,
        include: {
          user: { select: userSelect },
          _count: { select: { commentLikes: true } },
          replies: {
            include: {
              user: { select: userSelect },
              _count: { select: { commentLikes: true } },
            },
            orderBy: { createdAt: "asc" },
            take: 50,
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limit,
        take: limit,
      }),
      prisma.comment.count({ where }),
    ]);

    res.json({ comments, total, storyAuthorId });
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/comments/liked?ids=id1,id2,... — check which comments user has liked
router.get("/liked", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const idsStr = req.query.ids as string;
    if (!idsStr) return res.json({ likedIds: [] });

    const ids = idsStr.split(",").filter(Boolean).slice(0, 200); // Cap at 200 IDs to prevent abuse
    const likes = await prisma.commentLike.findMany({
      where: { userId: user.id, commentId: { in: ids } },
      select: { commentId: true },
    });

    res.json({ likedIds: likes.map((l) => l.commentId) });
  } catch (error) {
    console.error("Error checking liked comments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/comments — create a comment or reply (auth required)
router.post("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { storyId, chapterId, content, parentId } = req.body;
    if (!content?.trim()) {
      return res.status(400).json({ error: "Nội dung bình luận không được để trống" });
    }
    if (content.trim().length > 2000) {
      return res.status(400).json({ error: "Bình luận tối đa 2000 ký tự" });
    }
    if (!storyId && !chapterId && !parentId) {
      return res.status(400).json({ error: "storyId, chapterId, hoặc parentId là bắt buộc" });
    }

    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    let finalStoryId = storyId;
    let finalChapterId = chapterId || null;

    if (parentId) {
      const parent = await prisma.comment.findUnique({
        where: { id: parentId },
        select: { storyId: true, chapterId: true },
      });
      if (!parent) return res.status(404).json({ error: "Parent comment not found" });
      finalStoryId = parent.storyId;
      finalChapterId = parent.chapterId;
    } else if (chapterId) {
      const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { storyId: true } });
      if (!chapter) return res.status(404).json({ error: "Chapter not found" });
      finalStoryId = chapter.storyId;
    }

    // Block comments on unapproved stories
    if (finalStoryId) {
      const story = await prisma.story.findUnique({ where: { id: finalStoryId }, select: { approvalStatus: true } });
      if (!story || story.approvalStatus !== "approved") {
        return res.status(403).json({ error: "Truyện chưa được duyệt" });
      }
    }

    const comment = await prisma.comment.create({
      data: {
        content: content.trim(),
        userId: user.id,
        storyId: finalStoryId,
        chapterId: finalChapterId,
        parentId: parentId || null,
      },
      include: {
        user: { select: userSelect },
        _count: { select: { commentLikes: true } },
        replies: {
          include: {
            user: { select: userSelect },
            _count: { select: { commentLikes: true } },
          },
        },
      },
    });

    // ── Auto-complete comment quest (fire & forget) ──
    if (finalChapterId) {
      // Only count chapter comments for the quest
      completeCommentQuest(user.id).catch(() => {});
    }

    // Notify
    if (parentId) {
      const parentComment = await prisma.comment.findUnique({
        where: { id: parentId },
        select: { userId: true },
      });
      if (parentComment && parentComment.userId !== user.id) {
        // Get story slug for notification link
        const storyForLink = await prisma.story.findUnique({ where: { id: finalStoryId }, select: { slug: true } });
        const notifLink = finalChapterId
          ? `/story/${storyForLink?.slug || finalStoryId}/chapter/${finalChapterId}`
          : `/story/${storyForLink?.slug || finalStoryId}`;
        prisma.notification.create({
          data: {
            userId: parentComment.userId,
            title: "Trả lời bình luận",
            message: `${user.name} đã trả lời bình luận của bạn.`,
            type: "system",
            link: notifLink,
          },
        }).catch(() => {});
      }
    } else {
      prisma.story.findUnique({
        where: { id: finalStoryId },
        select: { authorId: true, title: true, slug: true },
      }).then((story) => {
        if (story && story.authorId !== user.id) {
          const notifLink = finalChapterId
            ? `/story/${story.slug}/chapter/${finalChapterId}`
            : `/story/${story.slug}`;
          prisma.notification.create({
            data: {
              userId: story.authorId,
              title: "Bình luận mới",
              message: `${user.name} đã bình luận về truyện "${story.title}".`,
              type: "system",
              link: notifLink,
            },
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    res.status(201).json(comment);
  } catch (error) {
    console.error("Error creating comment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/comments/:id/like — toggle like on comment
router.post("/:id/like", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const commentId = req.params.id;
    // Use interactive transaction to prevent race conditions on double-click
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.commentLike.findUnique({
        where: { userId_commentId: { userId: user.id, commentId } },
      });

      if (existing) {
        await tx.commentLike.delete({ where: { id: existing.id } });
        await tx.comment.update({ where: { id: commentId }, data: { likes: { decrement: 1 } } });
        // Guard against negative likes from counter drift
        await tx.comment.updateMany({ where: { id: commentId, likes: { lt: 0 } }, data: { likes: 0 } });
        return { liked: false };
      } else {
        await tx.commentLike.create({ data: { userId: user.id, commentId } });
        await tx.comment.update({ where: { id: commentId }, data: { likes: { increment: 1 } } });
        return { liked: true };
      }
    });
    return res.json(result);
  } catch (error) {
    console.error("Error toggling comment like:", error);
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
    if (comment.userId !== user.id && user.role !== "admin" && user.role !== "moderator") {
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
