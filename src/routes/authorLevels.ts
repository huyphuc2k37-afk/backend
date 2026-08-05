import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

/**
 * Calculate author's current stats
 */
async function getAuthorStats(authorId: string) {
  const [stories, earningsAgg] = await Promise.all([
    prisma.story.findMany({
      where: { authorId, approvalStatus: "approved" },
      select: { id: true, views: true },
    }),
    prisma.authorEarning.aggregate({
      where: { authorId },
      _sum: { amount: true },
    }),
  ]);

  const totalViews = stories.reduce((sum, s) => sum + s.views, 0);
  const totalStories = stories.length;
  const totalEarnings = earningsAgg._sum.amount || 0;

  return { totalViews, totalStories, totalEarnings };
}

/**
 * Find the highest level the author qualifies for
 */
async function calculateAuthorLevel(authorId: string) {
  const stats = await getAuthorStats(authorId);
  const levels = await prisma.authorLevel.findMany({
    orderBy: { level: "desc" },
  });

  let currentLevel = levels[levels.length - 1]; // default to lowest
  for (const level of levels) {
    if (
      stats.totalViews >= level.minViews &&
      stats.totalStories >= level.minStories &&
      stats.totalEarnings >= level.minEarnings
    ) {
      currentLevel = level;
      break;
    }
  }

  // Find next level
  const nextLevel = levels.find((l) => l.level === currentLevel.level + 1) || null;

  // Calculate progress to next level
  let progressToNext = 100;
  let viewsToNext = 0;
  let storiesToNext = 0;
  let earningsToNext = 0;

  if (nextLevel) {
    const viewsRange = nextLevel.minViews - currentLevel.minViews;
    const storiesRange = nextLevel.minStories - currentLevel.minStories;
    const earningsRange = nextLevel.minEarnings - currentLevel.minEarnings;

    const viewsProgress = viewsRange > 0
      ? (stats.totalViews - currentLevel.minViews) / viewsRange
      : 1;
    const storiesProgress = storiesRange > 0
      ? (stats.totalStories - currentLevel.minStories) / storiesRange
      : 1;
    const earningsProgress = earningsRange > 0
      ? (stats.totalEarnings - currentLevel.minEarnings) / earningsRange
      : 1;

    progressToNext = Math.min(100, Math.round(
      (viewsProgress + storiesProgress + earningsProgress) / 3 * 100
    ));

    viewsToNext = Math.max(0, nextLevel.minViews - stats.totalViews);
    storiesToNext = Math.max(0, nextLevel.minStories - stats.totalStories);
    earningsToNext = Math.max(0, nextLevel.minEarnings - stats.totalEarnings);
  }

  return {
    currentLevel,
    nextLevel,
    stats,
    progress: {
      percentage: progressToNext,
      viewsToNext,
      storiesToNext,
      earningsToNext,
    },
  };
}

// ─── GET /api/author/level — Get current author's level info ──
router.get("/level", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });

    if (!user || user.role !== "author") {
      return res.status(403).json({ error: "Chỉ tác giả mới có thể xem cấp bậc" });
    }

    const levelInfo = await calculateAuthorLevel(user.id);
    res.json(levelInfo);
  } catch (error) {
    console.error("Error fetching author level:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/levels — Get all level definitions ──
router.get("/", async (_req, res: Response) => {
  try {
    const levels = await prisma.authorLevel.findMany({
      orderBy: { level: "asc" },
    });
    res.json({ levels });
  } catch (error) {
    console.error("Error fetching levels:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/author/check-level — Check and update level ──
router.post("/check-level", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });

    if (!user || user.role !== "author") {
      return res.status(403).json({ error: "Chỉ tác giả mới có thể kiểm tra cấp bậc" });
    }

    const levelInfo = await calculateAuthorLevel(user.id);

    // Check if level changed - could emit notification here if needed
    res.json({
      ...levelInfo,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error checking level:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/author/badges — Get author's badges ──
router.get("/badges", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const badges = await prisma.authorBadge.findMany({
      where: {
        authorId: user.id,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { earnedAt: "desc" },
    });

    res.json({ badges });
  } catch (error) {
    console.error("Error fetching badges:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/author/badges/all — Get all author's badges including expired ──
router.get("/badges/all", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const badges = await prisma.authorBadge.findMany({
      where: { authorId: user.id },
      orderBy: { earnedAt: "desc" },
    });

    res.json({ badges });
  } catch (error) {
    console.error("Error fetching all badges:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/author/:authorId/badges — Get specific author's badges (public) ──
router.get("/:authorId/badges", async (req, res: Response) => {
  try {
    const { authorId } = req.params;

    const badges = await prisma.authorBadge.findMany({
      where: {
        authorId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { earnedAt: "desc" },
    });

    res.json({ badges });
  } catch (error) {
    console.error("Error fetching author badges:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/author/:authorId/level — Get specific author's level (public) ──
router.get("/:authorId/level", async (req, res: Response) => {
  try {
    const { authorId } = req.params;

    const author = await prisma.user.findUnique({
      where: { id: authorId },
      select: { id: true, role: true },
    });

    if (!author || author.role !== "author") {
      return res.status(404).json({ error: "Author not found" });
    }

    const levelInfo = await calculateAuthorLevel(authorId);
    res.json(levelInfo);
  } catch (error) {
    console.error("Error fetching author level:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
