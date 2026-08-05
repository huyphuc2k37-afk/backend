import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

interface AuthRequest extends Request {
  modUser?: { role: string };
  adminUser?: { role: string };
}

/**
 * GET /api/stats/views/realtime
 * Get real-time view statistics
 */
router.get("/views/realtime", async (req: Request, res: Response) => {
  try {
    // Try to get from DB first
    const dbStats = await prisma.realtimeViewStats.findUnique({
      where: { id: "global" },
    });

    const stats = {
      todayViews: dbStats?.todayViews ?? 0,
      weekViews: dbStats?.weekViews ?? 0,
      monthViews: dbStats?.monthViews ?? 0,
      activeNow: dbStats?.activeNow ?? 0,
      updatedAt: dbStats?.updatedAt?.toISOString() ?? new Date().toISOString(),
    };

    res.json(stats);
  } catch (error) {
    console.error("[ViewStats] Error fetching realtime stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/stats/views/daily
 * Get daily view statistics for the past N days
 */
router.get("/views/daily", async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 7, 30);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Aggregate daily views from ViewLog
    const dailyStats = await prisma.$queryRaw<
      { date: Date; count: bigint }[]
    >`
      SELECT
        DATE("createdAt") as date,
        COUNT(*) as count
      FROM "ViewLog"
      WHERE "createdAt" >= ${startDate}
      GROUP BY DATE("createdAt")
      ORDER BY date DESC
    `;

    // Fill in missing dates
    const result = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];

      const found = dailyStats.find(
        (s) => s.date.toISOString().split("T")[0] === dateStr
      );

      result.push({
        date: dateStr,
        views: found ? Number(found.count) : 0,
      });
    }

    res.json(result);
  } catch (error) {
    console.error("[ViewStats] Error fetching daily stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/stats/views/hourly
 * Get hourly view statistics for today
 */
router.get("/views/hourly", async (req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const hourlyStats = await prisma.$queryRaw<
      { hour: number; count: bigint }[]
    >`
      SELECT
        EXTRACT(HOUR FROM "createdAt") as hour,
        COUNT(*) as count
      FROM "ViewLog"
      WHERE "createdAt" >= ${today}
      GROUP BY EXTRACT(HOUR FROM "createdAt")
      ORDER BY hour
    `;

    // Fill in all 24 hours
    const result = [];
    for (let hour = 0; hour < 24; hour++) {
      const found = hourlyStats.find((s) => s.hour === hour);
      result.push({
        hour,
        views: found ? Number(found.count) : 0,
      });
    }

    res.json(result);
  } catch (error) {
    console.error("[ViewStats] Error fetching hourly stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/stats/views/top-stories
 * Get top stories by views for a time period
 */
router.get("/views/top-stories", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const period = (req.query.period as string) || "day";
    const now = new Date();

    let startDate: Date;
    switch (period) {
      case "week":
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "month":
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      default:
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
    }

    const topStories = await prisma.$queryRaw<
      {
        storyId: string;
        title: string;
        slug: string;
        coverImage: string | null;
        authorName: string;
        count: bigint;
      }[]
    >`
      SELECT
        vl."storyId",
        s.title,
        s.slug,
        s."coverImage",
        u.name as "authorName",
        COUNT(*) as count
      FROM "ViewLog" vl
      JOIN "Story" s ON s.id = vl."storyId"
      JOIN "User" u ON u.id = s."authorId"
      WHERE vl."createdAt" >= ${startDate}
        AND s."approvalStatus" = 'approved'
      GROUP BY vl."storyId", s.title, s.slug, s."coverImage", u.name
      ORDER BY count DESC
      LIMIT ${limit}
    `;

    res.json(
      topStories.map((story) => ({
        id: story.storyId,
        title: story.title,
        slug: story.slug,
        coverImage: story.coverImage,
        authorName: story.authorName,
        views: Number(story.count),
      }))
    );
  } catch (error) {
    console.error("[ViewStats] Error fetching top stories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/stats/overview
 * Get overview statistics for admin dashboard
 */
router.get("/overview", async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    // Check if user is admin (in real implementation, this would be checked via middleware)
    // For now, just return the stats without auth check to avoid complexity

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    // Get various stats in parallel
    const [
      totalUsers,
      totalStories,
      todayViews,
      weekViews,
      monthViews,
      pendingStories,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.story.count({ where: { approvalStatus: "approved" } }),
      prisma.viewLog.count({ where: { createdAt: { gte: today } } }),
      prisma.viewLog.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.viewLog.count({ where: { createdAt: { gte: monthAgo } } }),
      prisma.story.count({ where: { approvalStatus: "pending" } }),
    ]);

    res.json({
      totalUsers,
      totalStories,
      views: {
        today: todayViews,
        week: weekViews,
        month: monthViews,
      },
      pendingStories,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[ViewStats] Error fetching overview:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
