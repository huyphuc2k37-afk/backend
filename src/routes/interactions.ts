import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ─── POST /api/stories/:id/like — toggle like ──
router.post("/:id/like", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const storyId = req.params.id;

    // Only allow liking approved stories
    const story = await prisma.story.findUnique({ where: { id: storyId }, select: { approvalStatus: true } });
    if (!story || story.approvalStatus !== "approved") {
      return res.status(403).json({ error: "Truyện chưa được duyệt" });
    }

    // Use interactive transaction to prevent race conditions on double-click
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.storyLike.findUnique({
        where: { userId_storyId: { userId: user.id, storyId } },
      });

      if (existing) {
        await tx.storyLike.delete({ where: { id: existing.id } });
        await tx.story.update({ where: { id: storyId }, data: { likes: { decrement: 1 } } });
        // Guard against negative likes from counter drift
        await tx.story.updateMany({ where: { id: storyId, likes: { lt: 0 } }, data: { likes: 0 } });
        return { liked: false };
      } else {
        await tx.storyLike.create({ data: { userId: user.id, storyId } });
        await tx.story.update({ where: { id: storyId }, data: { likes: { increment: 1 } } });
        return { liked: true };
      }
    });
    return res.json(result);
  } catch (error) {
    console.error("Error toggling like:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/stories/:id/like — check if user liked ──
router.get("/:id/like", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const existing = await prisma.storyLike.findUnique({
      where: { userId_storyId: { userId: user.id, storyId: req.params.id } },
    });

    res.json({ liked: !!existing });
  } catch (error) {
    console.error("Error checking like:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/stories/:id/rate — set/update rating ──
router.post("/:id/rate", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const score = parseInt(req.body.score);
    if (!score || score < 1 || score > 5) {
      return res.status(400).json({ error: "Score must be between 1 and 5" });
    }

    const storyId = req.params.id;

    // Only allow rating approved stories
    const story = await prisma.story.findUnique({ where: { id: storyId }, select: { approvalStatus: true } });
    if (!story || story.approvalStatus !== "approved") {
      return res.status(403).json({ error: "Truyện chưa được duyệt" });
    }

    // Upsert rating + recalculate average in a single transaction
    const ratingResult = await prisma.$transaction(async (tx) => {
      await tx.rating.upsert({
        where: { userId_storyId: { userId: user.id, storyId } },
        create: { userId: user.id, storyId, score },
        update: { score },
      });

      const agg = await tx.rating.aggregate({
        where: { storyId },
        _avg: { score: true },
        _count: { score: true },
      });

      const averageRating = Math.round((agg._avg.score || 0) * 10) / 10;
      const ratingCount = agg._count.score;

      await tx.story.update({
        where: { id: storyId },
        data: { averageRating, ratingCount },
      });

      return { averageRating, ratingCount };
    });

    res.json({
      success: true,
      userScore: score,
      averageRating: ratingResult.averageRating,
      ratingCount: ratingResult.ratingCount,
    });
  } catch (error) {
    console.error("Error rating story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/stories/:id/rate — get user's rating ──
router.get("/:id/rate", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const rating = await prisma.rating.findUnique({
      where: { userId_storyId: { userId: user.id, storyId: req.params.id } },
    });

    res.json({ userScore: rating?.score || 0 });
  } catch (error) {
    console.error("Error fetching rating:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
