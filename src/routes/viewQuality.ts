import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { calculateQualityScore } from "../lib/fingerprint";
import type { AuthRequest } from "../middleware/auth";

const router = Router();

/**
 * POST /api/stats/views/quality
 * Record view quality data (dwell time, scroll depth, etc.)
 */
router.post("/views/quality", async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    const { storyId, dwellTime, scrollDepth, chaptersRead } = req.body;

    if (!storyId) {
      return res.status(400).json({ error: "storyId is required" });
    }

    // Get user ID if authenticated
    const userId = authReq.user?.sub ?? null;

    // Calculate quality score
    const qualityScore = calculateQualityScore({
      dwellTime: dwellTime || 0,
      scrollDepth: scrollDepth || 0,
      chaptersRead: chaptersRead || 0,
      hasComment: false, // Will be updated separately
      hasBookmark: false,
      hasRating: false,
    });

    // Create a ViewSession record
    await prisma.viewSession.create({
      data: {
        storyId,
        userId,
        qualityScore,
        dwellTime: dwellTime || 0,
        scrollDepth: scrollDepth || 0,
        chaptersRead: chaptersRead || 0,
        endedAt: new Date(),
      },
    });

    // Also update the most recent ViewLog entry for this story+IP
    // (We use IP from request context for better tracking)
    const clientIP = authReq.ip || authReq.socket?.remoteAddress || "unknown";

    await prisma.viewLog.updateMany({
      where: {
        storyId,
        ip: clientIP,
        dwellTime: 0, // Only update entries with 0 dwell time
      },
      data: {
        dwellTime: dwellTime || 0,
        qualityScore,
      },
    });

    console.log(`[Quality] Recorded: story=${storyId}, dwell=${dwellTime}s, scroll=${scrollDepth}, quality=${qualityScore}`);

    res.json({ success: true, qualityScore });
  } catch (error) {
    console.error("[Quality] Error recording quality:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/stats/views/quality/:storyId
 * Get average quality score for a story
 */
router.get("/views/quality/:storyId", async (req: Request, res: Response) => {
  try {
    const { storyId } = req.params;
    const days = Math.min(parseInt(req.query.days as string) || 7, 30);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const [avgQuality, viewCount, avgDwellTime] = await Promise.all([
      prisma.viewSession.aggregate({
        where: {
          storyId,
          startedAt: { gte: startDate },
          qualityScore: { gt: 0 },
        },
        _avg: { qualityScore: true },
      }),
      prisma.viewSession.count({
        where: {
          storyId,
          startedAt: { gte: startDate },
        },
      }),
      prisma.viewSession.aggregate({
        where: {
          storyId,
          startedAt: { gte: startDate },
          dwellTime: { gt: 0 },
        },
        _avg: { dwellTime: true },
      }),
    ]);

    res.json({
      storyId,
      period: `${days} days`,
      totalViews: viewCount,
      averageQualityScore: avgQuality._avg.qualityScore || 0,
      averageDwellTime: Math.round(avgDwellTime._avg.dwellTime || 0),
    });
  } catch (error) {
    console.error("[Quality] Error fetching quality:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
