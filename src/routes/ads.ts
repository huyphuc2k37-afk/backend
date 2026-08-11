import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired, authOptional } from "../middleware/auth";
import {
  getActivePlacements,
  getPlacementConfig,
  recordImpression,
  canWatchRewardAd,
  claimRewardAd,
  getRewardHistory,
  getAdAnalytics,
  initializeDefaultPlacements,
  getRewardConfig,
  AdPlacementLocation,
} from "../lib/adsManager";
import { rateLimit } from "../lib/rateLimit";
import { invalidateCache } from "../lib/cache";

const router = Router();

// ─── Initialize default placements on startup ─────────────────────────
initializeDefaultPlacements().catch((err) => {
  console.error("[Ads] Failed to initialize default placements:", err);
});

// ─── Helpers ──────────────────────────────────────────────────────────
function todayStr(): string {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 10);
}

// ─── GET /api/ads/placements — Get all active ad placements ─────────────
router.get("/placements", async (_req, res: Response) => {
  try {
    const placements = await getActivePlacements();
    
    res.json({
      placements,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching ad placements:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/ads/placements/:location — Get config for specific location ──
router.get("/placements/:location", async (req, res: Response) => {
  try {
    const { location } = req.params;
    const validLocations = ["banner_top", "banner_sidebar", "banner_footer", "in_content", "reward_video"];
    
    if (!validLocations.includes(location)) {
      return res.status(400).json({ error: "Invalid placement location" });
    }
    
    const config = await getPlacementConfig(location as AdPlacementLocation);
    res.json(config);
  } catch (error) {
    console.error("Error fetching ad placement config:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/ads/impression — Record an ad impression ────────────────
// Rate limit: 60 impressions per minute per user to prevent abuse
const IMPRESSION_LIMIT_KEY = "ads-impression";
const IMPRESSION_WINDOW_MS = 60_000;
const IMPRESSION_MAX = 60;

router.post("/impression", authOptional, async (req: AuthRequest, res: Response) => {
  try {
    const rl = rateLimit(IMPRESSION_LIMIT_KEY, { windowMs: IMPRESSION_WINDOW_MS, max: IMPRESSION_MAX });
    if (!rl.ok) {
      return res.status(429).json({ error: "Too many requests", retryAfterMs: rl.retryAfterMs });
    }
    const { placement, storyId, chapterId, adNetwork, adUnitId } = req.body;
    
    const validLocations = ["banner_top", "banner_sidebar", "banner_footer", "in_content", "reward_video"];
    if (!placement || !validLocations.includes(placement)) {
      return res.status(400).json({ error: "Invalid placement location" });
    }
    
    // Get userId if authenticated
    let userId: string | null = null;
    if (req.user) {
      const user = await prisma.user.findUnique({
        where: { email: req.user.email },
        select: { id: true },
      });
      userId = user?.id ?? null;
    }
    
    await recordImpression({
      userId,
      storyId: storyId || null,
      chapterId: chapterId || null,
      placement: placement as AdPlacementLocation,
      adNetwork: adNetwork || "google",
      adUnitId: adUnitId || null,
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("Error recording ad impression:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/ads/can-watch — Check if user can watch reward ad ──────────
router.get("/can-watch", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true },
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    const result = await canWatchRewardAd(user.id);
    const config = getRewardConfig();
    
    res.json({
      canWatch: result.canWatch,
      reason: result.reason || null,
      cooldownRemaining: result.cooldownRemaining || null,
      dailyRemaining: result.dailyRemaining ?? config.maxDailyRewards,
      dailyLimit: config.maxDailyRewards,
    });
  } catch (error) {
    console.error("Error checking reward ad eligibility:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/ads/reward — Claim reward video ad ───────────────────────
// Rate limit: 12 claims per minute (one every 5 seconds max)
const REWARD_LIMIT_KEY = "ads-reward";
const REWARD_WINDOW_MS = 60_000;
const REWARD_MAX = 12;

router.post("/reward", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const rl = rateLimit(REWARD_LIMIT_KEY, { windowMs: REWARD_WINDOW_MS, max: REWARD_MAX });
    if (!rl.ok) {
      return res.status(429).json({ error: "Too many requests", retryAfterMs: rl.retryAfterMs });
    }
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true },
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    // First record the impression
    await recordImpression({
      userId: user.id,
      placement: "reward_video",
      adNetwork: "google",
    });
    
    // Then claim the reward
    const result = await claimRewardAd(user.id);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({
      success: true,
      coins: result.coins,
      newBalance: result.newBalance,
      message: `Nhận thưởng thành công! +${result.coins} xu`,
    });
  } catch (error) {
    console.error("Error claiming reward ad:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/ads/reward-history — Get user's reward ad history ─────────
router.get("/reward-history", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true },
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const history = await getRewardHistory(user.id, limit);
    
    res.json({
      rewards: history.rewards.map((r) => ({
        id: r.id,
        coins: r.coins,
        watchedAt: r.watchedAt,
      })),
      todayCount: history.todayCount,
      dailyLimit: history.dailyLimit,
    });
  } catch (error) {
    console.error("Error fetching reward history:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/ads/stats — Get ad analytics (admin only) ─────────────────
router.get("/stats", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true, role: true },
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    const { startDate, endDate, placement } = req.query;
    const analytics = await getAdAnalytics({
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      placement: placement as string | undefined,
    });
    
    res.json(analytics);
  } catch (error) {
    console.error("Error fetching ad analytics:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── B7: Custom banner management (admin) ─────────────────────────────
const B7_VALID_LOCATIONS = ["banner_top", "banner_sidebar", "banner_footer", "in_content"];
const B7_MONTHLY_PRICE_DEFAULT = 500_000; // 500k VND / tháng

function requireAdmin(role: string | undefined): boolean {
  return role === "admin" || role === "moderator";
}

// ─── PUT /api/ads/placements/:location/custom ───────────────────────────
// Admin: cấu hình banner custom cho 1 vị trí (ảnh shop thủ công)
router.put("/placements/:location/custom", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { location } = req.params;
    if (!B7_VALID_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: "Invalid location for custom banner" });
    }

    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { role: true },
    });
    if (!requireAdmin(user?.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const {
      customImageUrl,
      customVideoUrl,
      clickUrl,
      advertiserName,
      advertiserPhone,
      monthlyPrice,
      startDate,
      endDate,
      paidUntil,
    } = req.body;

    if (!customImageUrl && !customVideoUrl) {
      return res.status(400).json({ error: "Cần cung cấp customImageUrl hoặc customVideoUrl" });
    }
    if (!clickUrl) {
      return res.status(400).json({ error: "clickUrl là bắt buộc" });
    }

    // Upsert (1 banner per location)
    const data = {
      location,
      adNetwork: "custom",
      adUnitId: null,
      isActive: true,
      customImageUrl: customImageUrl || null,
      customVideoUrl: customVideoUrl || null,
      clickUrl,
      advertiserName: advertiserName || null,
      advertiserPhone: advertiserPhone || null,
      monthlyPrice: monthlyPrice ?? B7_MONTHLY_PRICE_DEFAULT,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : null,
      paidUntil: paidUntil ? new Date(paidUntil) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: "custom",
    };

    const placement = await prisma.adPlacement.upsert({
      where: { location },
      create: data,
      update: data,
    });

    // Invalidate cache
    invalidateCache("ads:active_placements");

    res.json({ success: true, placement });
  } catch (error) {
    console.error("[B7] Error updating custom banner:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/ads/placements/:location/custom ───────────────────────
// Admin: gỡ banner custom, trở về ad network mặc định
router.delete("/placements/:location/custom", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { location } = req.params;
    if (!B7_VALID_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: "Invalid location" });
    }

    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { role: true },
    });
    if (!requireAdmin(user?.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    await prisma.adPlacement.update({
      where: { location },
      data: {
        status: "network",
        customImageUrl: null,
        customVideoUrl: null,
        clickUrl: null,
        advertiserName: null,
        advertiserPhone: null,
      },
    });

    invalidateCache("ads:active_placements");

    res.json({ success: true });
  } catch (error) {
    console.error("[B7] Error deleting custom banner:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/ads/click/:location — Record a banner click ──────────────────
router.post("/click/:location", async (req, res: Response) => {
  try {
    const { location } = req.params;
    const validLocations = ["banner_top", "banner_sidebar", "banner_footer", "in_content"];
    if (!validLocations.includes(location)) {
      return res.status(400).json({ error: "Invalid placement location" });
    }

    await prisma.adPlacement.updateMany({
      where: { location, status: "custom" },
      data: { clickCount: { increment: 1 } },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("[Ads] Error recording click:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/ads/banners — Public: list active custom banners ──────────
// Trả về banner_custom để frontend hiển thị (kèm clickUrl)
router.get("/banners", async (_req, res: Response) => {
  try {
    const now = new Date();
    const banners = await prisma.adPlacement.findMany({
      where: {
        isActive: true,
        status: "custom",
        paidUntil: { gte: now },
      },
      select: {
        location: true,
        customImageUrl: true,
        customImageMobileUrl: true,
        customVideoUrl: true,
        clickUrl: true,
        advertiserName: true,
        startDate: true,
        endDate: true,
        paidUntil: true,
      },
    });
    res.json({ banners });
  } catch (error) {
    console.error("[B7] Error fetching banners:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── B7: Admin CRUD for banners ────────────────────────────────────────

// GET /api/admin/ads/banners — List all banners (active/inactive/expired)
router.get("/admin/ads/banners", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { role: true },
    });
    if (!requireAdmin(user?.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const banners = await prisma.adPlacement.findMany({
      orderBy: { location: "asc" },
      select: {
        id: true,
        location: true,
        adNetwork: true,
        isActive: true,
        customImageUrl: true,
        customImageMobileUrl: true,
        customVideoUrl: true,
        clickUrl: true,
        advertiserName: true,
        advertiserPhone: true,
        advertiserEmail: true,
        monthlyPrice: true,
        startDate: true,
        endDate: true,
        paidUntil: true,
        clickCount: true,
        impressionCount: true,
        isOpenNewTab: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ banners });
  } catch (error) {
    console.error("[B7] Error listing banners:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/ads/banners/:location — Update/create banner config
router.patch("/admin/ads/banners/:location", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { location } = req.params;
    if (!B7_VALID_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: "Invalid location" });
    }

    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { role: true, id: true },
    });
    if (!requireAdmin(user?.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const {
      customImageUrl,
      customImageMobileUrl,
      clickUrl,
      advertiserName,
      advertiserPhone,
      advertiserEmail,
      monthlyPrice,
      startDate,
      endDate,
      paidUntil,
      isOpenNewTab,
      isActive,
    } = req.body;

    // Validate at least one image
    if ((!customImageUrl || !customImageUrl.trim()) && (!customImageMobileUrl || !customImageMobileUrl.trim())) {
      return res.status(400).json({ error: "Cần ít nhất 1 ảnh banner (PC hoặc Mobile)" });
    }
    if (!clickUrl || !clickUrl.trim()) {
      return res.status(400).json({ error: "clickUrl là bắt buộc" });
    }

    const data: Record<string, unknown> = {
      adNetwork: "custom",
      adUnitId: null,
      status: "custom",
    };

    if (customImageUrl !== undefined) data.customImageUrl = customImageUrl.trim() || null;
    if (customImageMobileUrl !== undefined) data.customImageMobileUrl = customImageMobileUrl.trim() || null;
    if (clickUrl !== undefined) data.clickUrl = clickUrl.trim();
    if (advertiserName !== undefined) data.advertiserName = advertiserName?.trim() || null;
    if (advertiserPhone !== undefined) data.advertiserPhone = advertiserPhone?.trim() || null;
    if (advertiserEmail !== undefined) data.advertiserEmail = advertiserEmail?.trim() || null;
    if (monthlyPrice !== undefined) data.monthlyPrice = monthlyPrice;
    if (isOpenNewTab !== undefined) data.isOpenNewTab = isOpenNewTab;
    if (isActive !== undefined) data.isActive = isActive;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (paidUntil !== undefined) data.paidUntil = paidUntil ? new Date(paidUntil) : null;

    const placement = await prisma.adPlacement.upsert({
      where: { location },
      create: { location, ...data } as Parameters<typeof prisma.adPlacement.create>[0]["data"],
      update: data as Parameters<typeof prisma.adPlacement.update>[0]["data"],
    });

    invalidateCache("ads:active_placements");

    res.json({ success: true, banner: placement });
  } catch (error) {
    console.error("[B7] Error updating banner:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/ads/banners/:location — Remove banner (back to network)
router.delete("/admin/ads/banners/:location", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { location } = req.params;
    if (!B7_VALID_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: "Invalid location" });
    }

    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { role: true },
    });
    if (!requireAdmin(user?.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    await prisma.adPlacement.update({
      where: { location },
      data: {
        status: "network",
        isActive: true,
        customImageUrl: null,
        customImageMobileUrl: null,
        customVideoUrl: null,
        clickUrl: null,
        advertiserName: null,
        advertiserPhone: null,
        advertiserEmail: null,
        monthlyPrice: null,
        startDate: null,
        endDate: null,
        paidUntil: null,
      },
    });

    invalidateCache("ads:active_placements");

    res.json({ success: true });
  } catch (error) {
    console.error("[B7] Error deleting banner:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
