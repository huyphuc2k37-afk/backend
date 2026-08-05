import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ─── Ad revenue config (coins per impression) ────────────────────────────────────
// Platform keeps 30%, author gets 70%
const PLATFORM_SHARE = 0.3;
const AUTHOR_SHARE = 0.7;
const COINS_PER_IMPRESSION = 1; // 1 coin per ad impression

// ─── Helpers ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 10);
}

// Get or create author ad config
async function getOrCreateAdConfig(authorId: string) {
  let config = await prisma.authorAdConfig.findUnique({
    where: { authorId },
  });

  if (!config) {
    config = await prisma.authorAdConfig.create({
      data: { authorId },
    });
  }

  return config;
}

// ─── GET /api/author/ads/config ────────────────────────────────────────────────
// Get author's ad configuration
router.get("/config", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role !== "author" && user.role !== "admin") {
      return res.status(403).json({ error: "Author access required" });
    }

    const config = await getOrCreateAdConfig(user.id);

    // Get author's stories with ad status
    const stories = await prisma.story.findMany({
      where: { authorId: user.id, approvalStatus: "approved" },
      select: {
        id: true,
        title: true,
        slug: true,
        views: true,
        chapters: {
          select: { id: true, number: true },
          orderBy: { number: "desc" },
          take: 1,
        },
      },
    });

    res.json({
      enabled: config.enabled,
      adFrequency: config.adFrequency,
      revenueShare: config.revenueShare,
      totalEarnings: config.totalEarnings,
      pendingWithdrawal: config.pendingWithdrawal,
      stories: stories.map((s) => ({
        id: s.id,
        title: s.title,
        slug: s.slug,
        views: s.views,
        latestChapter: s.chapters[0]?.number || 0,
      })),
    });
  } catch (error) {
    console.error("Error fetching author ad config:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/author/ads/config ────────────────────────────────────────────────
// Update ad settings (frequency, enabled status)
router.put("/config", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role !== "author" && user.role !== "admin") {
      return res.status(403).json({ error: "Author access required" });
    }

    const { enabled, adFrequency } = req.body;

    const updateData: {
      enabled?: boolean;
      adFrequency?: number;
    } = {};

    if (typeof enabled === "boolean") {
      updateData.enabled = enabled;
    }

    if (typeof adFrequency === "number" && adFrequency >= 1 && adFrequency <= 10) {
      updateData.adFrequency = adFrequency;
    }

    const config = await prisma.authorAdConfig.update({
      where: { authorId: user.id },
      data: updateData,
    });

    res.json({
      success: true,
      enabled: config.enabled,
      adFrequency: config.adFrequency,
    });
  } catch (error) {
    console.error("Error updating author ad config:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/author/ads/earnings ──────────────────────────────────────────────
// Get earnings history
router.get("/earnings", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role !== "author" && user.role !== "admin") {
      return res.status(403).json({ error: "Author access required" });
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const storyId = req.query.storyId as string | undefined;

    const whereClause: {
      authorId: string;
      storyId?: string;
    } = { authorId: user.id };

    if (storyId) {
      whereClause.storyId = storyId;
    }

    const earnings = await prisma.authorAdEarning.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Get story titles
    const storyIds = [...new Set(earnings.map((e) => e.storyId))];
    const stories = await prisma.story.findMany({
      where: { id: { in: storyIds } },
      select: { id: true, title: true, slug: true },
    });
    const storyMap = new Map(stories.map((s) => [s.id, s]));

    res.json({
      earnings: earnings.map((e) => ({
        id: e.id,
        storyId: e.storyId,
        storyTitle: storyMap.get(e.storyId)?.title || "Unknown",
        storySlug: storyMap.get(e.storyId)?.slug || "",
        chapterNumber: e.chapterNumber,
        chapterId: e.chapterId,
        impressions: e.impressions,
        earnings: e.earnings,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching author ad earnings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/author/ads/stats ────────────────────────────────────────────────
// Get stats overview (daily, weekly, monthly)
router.get("/stats", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role !== "author" && user.role !== "admin") {
      return res.status(403).json({ error: "Author access required" });
    }

    // Get config
    const config = await getOrCreateAdConfig(user.id);

    // Period filter
    const period = (req.query.period as string) || "30d";
    let startDate: Date;
    if (period === "7d") {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === "30d") {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(0); // All time
    }

    // Aggregate earnings
    const earningsStats = await prisma.authorAdEarning.aggregate({
      where: {
        authorId: user.id,
        createdAt: { gte: startDate },
      },
      _sum: { impressions: true, earnings: true },
      _count: true,
    });

    // Daily breakdown for chart
    const dailyEarnings = await prisma.authorAdEarning.groupBy({
      by: ["createdAt"],
      where: {
        authorId: user.id,
        createdAt: { gte: startDate },
      },
      _sum: { impressions: true, earnings: true },
      _count: true,
    });

    // Process daily data
    const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    const dailyMap: Record<string, { impressions: number; earnings: number }> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyMap[key] = { impressions: 0, earnings: 0 };
    }

    for (const e of dailyEarnings) {
      const key = e.createdAt.toISOString().slice(0, 10);
      if (dailyMap[key]) {
        dailyMap[key].impressions += e._sum.impressions || 0;
        dailyMap[key].earnings += e._sum.earnings || 0;
      }
    }

    const dailyChart = Object.entries(dailyMap).map(([date, data]) => ({
      date,
      day: new Date(date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }),
      impressions: data.impressions,
      earnings: data.earnings,
    }));

    // Top stories by earnings
    const topStories = await prisma.authorAdEarning.groupBy({
      by: ["storyId"],
      where: {
        authorId: user.id,
        createdAt: { gte: startDate },
      },
      _sum: { impressions: true, earnings: true },
      orderBy: { _sum: { earnings: "desc" } },
      take: 10,
    });

    // Get story titles
    const storyIds = topStories.map((s) => s.storyId);
    const stories = await prisma.story.findMany({
      where: { id: { in: storyIds } },
      select: { id: true, title: true, slug: true },
    });
    const storyMap = new Map(stories.map((s) => [s.id, s]));

    res.json({
      totalEarnings: config.totalEarnings,
      pendingWithdrawal: config.pendingWithdrawal,
      periodEarnings: earningsStats._sum.earnings || 0,
      periodImpressions: earningsStats._sum.impressions || 0,
      periodChapters: earningsStats._count,
      revenueShare: config.revenueShare,
      dailyChart,
      topStories: topStories.map((s) => ({
        storyId: s.storyId,
        title: storyMap.get(s.storyId)?.title || "Unknown",
        slug: storyMap.get(s.storyId)?.slug || "",
        impressions: s._sum.impressions || 0,
        earnings: s._sum.earnings || 0,
      })),
    });
  } catch (error) {
    console.error("Error fetching author ad stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/author/ads/withdraw ─────────────────────────────────────────────
// Request withdrawal of ad earnings
router.post("/withdraw", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role !== "author" && user.role !== "admin") {
      return res.status(403).json({ error: "Author access required" });
    }

    const config = await getOrCreateAdConfig(user.id);

    // Calculate available for withdrawal (totalEarnings - pendingWithdrawal)
    const availableForWithdrawal = config.totalEarnings - config.pendingWithdrawal;

    if (availableForWithdrawal <= 0) {
      return res.status(400).json({ error: "No earnings available for withdrawal" });
    }

    // Get withdrawal info from request
    const { bankName, bankAccount, bankHolder } = req.body;

    if (!bankName || !bankAccount || !bankHolder) {
      return res.status(400).json({ error: "Missing bank information" });
    }

    // Create withdrawal request
    // Add to pending withdrawal and deduct from available balance
    const withdrawal = await prisma.$transaction(async (tx) => {
      // Update pending withdrawal
      await tx.authorAdConfig.update({
        where: { authorId: user.id },
        data: {
          pendingWithdrawal: { increment: availableForWithdrawal },
        },
      });

      // Create withdrawal record
      const wd = await tx.withdrawal.create({
        data: {
          userId: user.id,
          amount: availableForWithdrawal,
          moneyAmount: availableForWithdrawal, // 1 coin = 1 VND
          bankName,
          bankAccount,
          bankHolder,
          status: "pending",
        },
      });

      return wd;
    });

    res.json({
      success: true,
      withdrawalId: withdrawal.id,
      amount: availableForWithdrawal,
      message: "Yêu cầu rút tiền đã được gửi thành công",
    });
  } catch (error) {
    console.error("Error processing author ad withdrawal:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── INTERNAL: POST /api/author/ads/record ────────────────────────────────────
// Record an ad impression (called internally when user views a chapter with ads)
router.post("/record", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { storyId, chapterId, chapterNumber, showAd } = req.body;

    if (!storyId || !chapterId || typeof chapterNumber !== "number") {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get story and check if author has ads enabled
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { authorId: true },
    });

    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }

    const adConfig = await getOrCreateAdConfig(story.authorId);

    if (!adConfig.enabled) {
      return res.json({ adShown: false, reason: "Ads disabled by author" });
    }

    // Check if this chapter should show an ad based on frequency
    const shouldShowAd = chapterNumber % adConfig.adFrequency === 0;

    if (!shouldShowAd) {
      return res.json({ adShown: false, reason: "Not scheduled for ad" });
    }

    // Record the impression and earnings
    const impressionEarnings = Math.floor(COINS_PER_IMPRESSION * AUTHOR_SHARE);

    const result = await prisma.$transaction(async (tx) => {
      // Create or update earning record
      let earning = await tx.authorAdEarning.findFirst({
        where: {
          authorId: story.authorId,
          storyId,
          chapterId,
        },
      });

      if (earning) {
        earning = await tx.authorAdEarning.update({
          where: { id: earning.id },
          data: {
            impressions: { increment: 1 },
            earnings: { increment: impressionEarnings },
          },
        });
      } else {
        earning = await tx.authorAdEarning.create({
          data: {
            authorId: story.authorId,
            storyId,
            chapterNumber,
            chapterId,
            impressions: 1,
            earnings: impressionEarnings,
          },
        });
      }

      // Update total earnings in config
      await tx.authorAdConfig.update({
        where: { authorId: story.authorId },
        data: {
          totalEarnings: { increment: impressionEarnings },
        },
      });

      // Log the impression
      await tx.authorAdLog.create({
        data: {
          authorId: story.authorId,
          storyId,
          chapterId,
          adShown: true,
          userId: user.id,
        },
      });

      return earning;
    });

    res.json({
      adShown: true,
      earnings: result.earnings,
      message: "Ad impression recorded",
    });
  } catch (error) {
    console.error("Error recording author ad:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── INTERNAL: GET /api/author/ads/check ──────────────────────────────────────
// Check if a chapter should show author ad
router.get("/check", async (req, res: Response) => {
  try {
    const { storyId, chapterNumber } = req.query;

    if (!storyId || typeof chapterNumber !== "string") {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const story = await prisma.story.findUnique({
      where: { id: storyId as string },
      select: { authorId: true },
    });

    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }

    const adConfig = await getOrCreateAdConfig(story.authorId);

    if (!adConfig.enabled) {
      return res.json({ shouldShowAd: false, reason: "Ads disabled" });
    }

    const chapterNum = parseInt(chapterNumber as string, 10);
    const shouldShowAd = chapterNum % adConfig.adFrequency === 0;

    res.json({
      shouldShowAd,
      reason: shouldShowAd ? "Scheduled for ad" : `Not at ad frequency (every ${adConfig.adFrequency} chapters)`,
      adFrequency: adConfig.adFrequency,
      revenueShare: adConfig.revenueShare,
    });
  } catch (error) {
    console.error("Error checking author ad:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── B8: Sponsor Video Support ─────────────────────────────────────────────
// User watches a sponsor video to support an author. Platform credits 100 coins
// to the author's wallet. Capped at MAX_VIDEO_SUPPORT_PER_DAY per user per story.
//
// This is a separate flow from /api/ads/reward (which pays the USER 5 coins for
// watching). Here, the cost is absorbed by the platform's ad-network revenue,
// not the user's coin balance.

const B8_VIDEO_COINS = 100; // 100 xu/lần ủng hộ
const B8_MAX_PER_DAY = 10; // max 10 lần/user/day/story
const B8_COOLDOWN_SECONDS = 60; // chống spam — phải đợi 60s giữa 2 lần

// ─── GET /api/author/ads/video-status/:storyId ──────────────────────────────
// Trả về: còn được ủng hộ bao nhiêu lần hôm nay? + cooldown còn lại?
router.get("/video-status/:storyId", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { storyId } = req.params;
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, title: true, authorId: true, approvalStatus: true },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });
    if (story.approvalStatus !== "approved") {
      return res.json({ canSupport: false, reason: "Story not approved", todayCount: 0, maxPerDay: B8_MAX_PER_DAY });
    }

    // Cannot support your own story
    if (story.authorId === user.id) {
      return res.json({ canSupport: false, reason: "Cannot support your own story", todayCount: 0, maxPerDay: B8_MAX_PER_DAY });
    }

    // Count today's supports for this user + story using AuthorEarning(type=view, chapterTitle starts with video marker)
    const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const todayStart = new Date(vnNow.toISOString().slice(0, 10) + "T00:00:00+07:00");
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const todayCount = await prisma.authorEarning.count({
      where: {
        fromUserId: user.id,
        storyId,
        type: "view",
        chapterTitle: { startsWith: "🎬 Video ủng hộ" },
        createdAt: { gte: todayStart, lt: todayEnd },
      },
    });

    // Get last support for cooldown
    const lastSupport = await prisma.authorEarning.findFirst({
      where: { fromUserId: user.id, storyId, type: "view", chapterTitle: { startsWith: "🎬 Video ủng hộ" } },
      orderBy: { createdAt: "desc" },
    });
    let cooldownRemaining = 0;
    if (lastSupport) {
      const elapsed = Math.floor((Date.now() - lastSupport.createdAt.getTime()) / 1000);
      cooldownRemaining = Math.max(0, B8_COOLDOWN_SECONDS - elapsed);
    }

    const remainingToday = Math.max(0, B8_MAX_PER_DAY - todayCount);
    const canSupport = remainingToday > 0 && cooldownRemaining === 0;

    res.json({
      canSupport,
      reason: !canSupport
        ? remainingToday === 0
          ? `Bạn đã ủng hộ tối đa ${B8_MAX_PER_DAY} lần cho truyện này hôm nay`
          : `Vui lòng đợi ${cooldownRemaining}s`
        : null,
      todayCount,
      maxPerDay: B8_MAX_PER_DAY,
      remainingToday,
      cooldownRemaining,
      coinsPerSupport: B8_VIDEO_COINS,
    });
  } catch (error) {
    console.error("Error fetching B8 video status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/author/ads/support-video/:storyId ───────────────────────────
// User finished watching a sponsor video → platform credits author 100 xu.
router.post("/support-video/:storyId", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { storyId } = req.params;
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, title: true, slug: true, authorId: true, approvalStatus: true },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });
    if (story.approvalStatus !== "approved") {
      return res.status(400).json({ error: "Truyện chưa được duyệt" });
    }
    if (story.authorId === user.id) {
      return res.status(400).json({ error: "Không thể ủng hộ truyện của chính mình" });
    }

    // Re-check daily limit + cooldown atomically
    const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const todayStart = new Date(vnNow.toISOString().slice(0, 10) + "T00:00:00+07:00");
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const todayCount = await prisma.authorEarning.count({
      where: {
        fromUserId: user.id,
        storyId,
        type: "view",
        chapterTitle: { startsWith: "🎬 Video ủng hộ" },
        createdAt: { gte: todayStart, lt: todayEnd },
      },
    });
    if (todayCount >= B8_MAX_PER_DAY) {
      return res.status(429).json({
        error: `Bạn đã ủng hộ tối đa ${B8_MAX_PER_DAY} lần cho truyện này hôm nay`,
        maxPerDay: B8_MAX_PER_DAY,
      });
    }

    const lastSupport = await prisma.authorEarning.findFirst({
      where: { fromUserId: user.id, storyId, type: "view", chapterTitle: { startsWith: "🎬 Video ủng hộ" } },
      orderBy: { createdAt: "desc" },
    });
    if (lastSupport) {
      const elapsed = Math.floor((Date.now() - lastSupport.createdAt.getTime()) / 1000);
      if (elapsed < B8_COOLDOWN_SECONDS) {
        return res.status(429).json({
          error: `Vui lòng đợi ${B8_COOLDOWN_SECONDS - elapsed}s`,
          cooldownRemaining: B8_COOLDOWN_SECONDS - elapsed,
        });
      }
    }

    // Atomic: credit author + log + earning record
    const result = await prisma.$transaction(async (tx) => {
      // Credit author's coin balance
      await tx.user.update({
        where: { id: story.authorId },
        data: { coinBalance: { increment: B8_VIDEO_COINS } },
      });

      // Create earning record (platform absorbs cost, author gets 100% of B8_VIDEO_COINS)
      await tx.authorEarning.create({
        data: {
          type: "view",
          amount: B8_VIDEO_COINS,
          authorId: story.authorId,
          fromUserId: user.id,
          storyId: story.id,
          storyTitle: story.title,
          chapterTitle: "🎬 Video ủng hộ 100 xu",
        },
      });

      // Update author's ad config total
      await tx.authorAdConfig.upsert({
        where: { authorId: story.authorId },
        create: {
          authorId: story.authorId,
          totalEarnings: B8_VIDEO_COINS,
        },
        update: {
          totalEarnings: { increment: B8_VIDEO_COINS },
        },
      });

      // Notify author
      await tx.notification.create({
        data: {
          userId: story.authorId,
          title: "🎬 Có người xem video ủng hộ bạn",
          message: `${user.name} vừa xem video ủng hộ truyện "${story.title}". Bạn nhận được ${B8_VIDEO_COINS} xu.`,
          type: "wallet",
          link: `/story/${story.slug}`,
        },
      });

      return { success: true };
    });

    // Get fresh balance for response
    const freshAuthor = await prisma.user.findUnique({
      where: { id: story.authorId },
      select: { coinBalance: true },
    });

    res.json({
      success: true,
      coinsGiven: B8_VIDEO_COINS,
      storyTitle: story.title,
      authorBalance: freshAuthor?.coinBalance,
      remainingToday: Math.max(0, B8_MAX_PER_DAY - todayCount - 1),
    });
  } catch (error) {
    console.error("Error processing B8 support-video:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
