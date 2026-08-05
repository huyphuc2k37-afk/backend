import prisma from "./prisma";
import { cached, SHORT_TTL } from "./cache";

// ─── Types ──────────────────────────────────────────────────────────────
export type AdPlacementLocation = "banner_top" | "banner_sidebar" | "banner_footer" | "in_content" | "reward_video";

export interface AdConfig {
  location: AdPlacementLocation;
  isActive: boolean;
  adNetwork: string;
  adUnitId: string | null;
  priority: number;
  // B7: custom banner fields (used when status === "custom")
  customImageUrl?: string | null;
  customVideoUrl?: string | null;
  clickUrl?: string | null;
  advertiserName?: string | null;
  monthlyPrice?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  paidUntil?: string | null;
  status?: string;
}

export interface RewardAdConfig {
  coinsPerAd: number;
  cooldownMinutes: number;
  maxDailyRewards: number;
}

// ─── Constants ────────────────────────────────────────────────────────
const REWARD_COINS = 5;
const REWARD_COOLDOWN_MINUTES = 5;
const MAX_DAILY_REWARDS = 10;

const FALLBACK_AD_UNITS: Record<AdPlacementLocation, string> = {
  banner_top: "ca-app-pub-0000000000000000/0000000000",
  banner_sidebar: "ca-app-pub-0000000000000000/0000000001",
  banner_footer: "ca-app-pub-0000000000000000/0000000002",
  in_content: "ca-app-pub-0000000000000000/0000000003",
  reward_video: "ca-app-pub-0000000000000000/0000000004",
};

// ─── Ad Configuration Management ─────────────────────────────────────

/**
 * Get all active ad placements from database
 */
export async function getActivePlacements(): Promise<AdConfig[]> {
  const cacheKey = "ads:active_placements";
  return cached<AdConfig[]>(cacheKey, SHORT_TTL, async () => {
    const placements = await prisma.adPlacement.findMany({
      where: { isActive: true },
      orderBy: { priority: "desc" },
    });
    return placements.map((p) => {
      // B7: Auto-expire custom banners whose paidUntil has passed
      const now = new Date();
      const paidUntil = p.paidUntil ?? null;
      const isExpired = paidUntil && paidUntil < now;
      const effectiveStatus = isExpired ? "expired" : p.status;
      return {
        location: p.location as AdPlacementLocation,
        isActive: p.isActive && !isExpired,
        adNetwork: p.adNetwork,
        adUnitId: p.adUnitId,
        priority: p.priority,
        customImageUrl: p.customImageUrl ?? null,
        customVideoUrl: p.customVideoUrl ?? null,
        clickUrl: p.clickUrl ?? null,
        advertiserName: p.advertiserName ?? null,
        monthlyPrice: p.monthlyPrice ?? null,
        startDate: p.startDate?.toISOString() ?? null,
        endDate: p.endDate?.toISOString() ?? null,
        paidUntil: p.paidUntil?.toISOString() ?? null,
        status: effectiveStatus,
      };
    });
  });
}

/**
 * Get ad configuration for a specific location
 */
export async function getPlacementConfig(location: AdPlacementLocation): Promise<AdConfig> {
  const placements = await getActivePlacements();
  const placement = placements.find((p) => p.location === location);
  
  if (placement) {
    return placement;
  }

  // Return default config if not found in database
  return {
    location,
    isActive: true,
    adNetwork: "google",
    adUnitId: FALLBACK_AD_UNITS[location],
    priority: 0,
  };
}

/**
 * Get ad unit ID for a specific location (with fallback)
 */
export async function getAdUnitId(location: AdPlacementLocation): Promise<string> {
  const config = await getPlacementConfig(location);
  return config.adUnitId || FALLBACK_AD_UNITS[location];
}

/**
 * Check if an ad location is active
 */
export async function isAdLocationActive(location: AdPlacementLocation): Promise<boolean> {
  const config = await getPlacementConfig(location);
  return config.isActive;
}

// ─── Ad Impression Tracking ────────────────────────────────────────────

/**
 * Record an ad impression
 */
export async function recordImpression(params: {
  userId?: string | null;
  storyId?: string | null;
  chapterId?: string | null;
  placement: AdPlacementLocation;
  adNetwork?: string;
  adUnitId?: string;
}): Promise<void> {
  const { userId, storyId, chapterId, placement, adNetwork, adUnitId } = params;

  await prisma.adImpression.create({
    data: {
      userId: userId || null,
      storyId: storyId || null,
      chapterId: chapterId || null,
      placement,
      adNetwork: adNetwork || "google",
      adUnitId: adUnitId || null,
    },
  });

  // Update daily analytics
  await updateDailyAnalytics(placement, "impression");
}

/**
 * Update daily analytics for a placement
 */
async function updateDailyAnalytics(placement: string, type: "impression" | "reward"): Promise<void> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    await prisma.adAnalytics.upsert({
      where: {
        date_placement: { date: dateStr, placement },
      },
      create: {
        date: dateStr,
        placement,
        impressions: type === "impression" ? 1 : 0,
        rewardsClaimed: type === "reward" ? 1 : 0,
        coinsDistributed: type === "reward" ? REWARD_COINS : 0,
      },
      update: {
        impressions: type === "impression" ? { increment: 1 } : undefined,
        rewardsClaimed: type === "reward" ? { increment: 1 } : undefined,
        coinsDistributed: type === "reward" ? { increment: REWARD_COINS } : undefined,
      },
    });
  } catch (error) {
    console.error("[AdsManager] Failed to update daily analytics:", error);
  }
}

// ─── Reward Ad Logic ──────────────────────────────────────────────────

/**
 * Get reward ad configuration
 */
export function getRewardConfig(): RewardAdConfig {
  return {
    coinsPerAd: REWARD_COINS,
    cooldownMinutes: REWARD_COOLDOWN_MINUTES,
    maxDailyRewards: MAX_DAILY_REWARDS,
  };
}

/**
 * Check if a user can watch a reward ad
 */
export async function canWatchRewardAd(userId: string): Promise<{
  canWatch: boolean;
  reason?: string;
  cooldownRemaining?: number;
  dailyRemaining?: number;
}> {
  const config = getRewardConfig();
  const now = new Date();

  // Check cooldown (5 minutes between reward ads)
  const cooldownStart = new Date(now.getTime() - config.cooldownMinutes * 60 * 1000);
  const lastReward = await prisma.adReward.findFirst({
    where: {
      userId,
      watchedAt: { gte: cooldownStart },
    },
    orderBy: { watchedAt: "desc" },
  });

  if (lastReward) {
    const cooldownEnd = new Date(lastReward.watchedAt.getTime() + config.cooldownMinutes * 60 * 1000);
    const cooldownRemaining = Math.max(0, Math.ceil((cooldownEnd.getTime() - now.getTime()) / 1000 / 60));
    return {
      canWatch: false,
      reason: "cooldown",
      cooldownRemaining,
    };
  }

  // Check daily limit
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const todayRewards = await prisma.adReward.count({
    where: {
      userId,
      watchedAt: { gte: todayStart },
    },
  });

  if (todayRewards >= config.maxDailyRewards) {
    return {
      canWatch: false,
      reason: "daily_limit",
      dailyRemaining: 0,
    };
  }

  return {
    canWatch: true,
    dailyRemaining: config.maxDailyRewards - todayRewards,
  };
}

/**
 * Claim a reward video ad and add coins to user balance
 */
export async function claimRewardAd(userId: string): Promise<{
  success: boolean;
  coins?: number;
  error?: string;
  newBalance?: number;
}> {
  // First verify user can claim
  const canClaim = await canWatchRewardAd(userId);
  if (!canClaim.canWatch) {
    if (canClaim.reason === "cooldown") {
      return { success: false, error: `Vui lòng chờ ${canClaim.cooldownRemaining} phút trước khi xem thêm` };
    }
    return { success: false, error: "Bạn đã đạt giới hạn xem quảng cáo hôm nay" };
  }

  const config = getRewardConfig();

  try {
    // Record reward and add coins in a transaction
    const [reward, updatedUser] = await prisma.$transaction([
      prisma.adReward.create({
        data: {
          userId,
          coins: config.coinsPerAd,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { coinBalance: { increment: config.coinsPerAd } },
      }),
    ]);

    // Update daily analytics
    await updateDailyAnalytics("reward_video", "reward");

    return {
      success: true,
      coins: config.coinsPerAd,
      newBalance: updatedUser.coinBalance,
    };
  } catch (error) {
    console.error("[AdsManager] Failed to claim reward ad:", error);
    return { success: false, error: "Không thể nhận thưởng, vui lòng thử lại" };
  }
}

/**
 * Get user's reward ad history
 */
export async function getRewardHistory(userId: string, limit = 20): Promise<{
  rewards: Array<{ id: string; coins: number; watchedAt: Date }>;
  todayCount: number;
  dailyLimit: number;
}> {
  const config = getRewardConfig();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [rewards, todayCount] = await Promise.all([
    prisma.adReward.findMany({
      where: { userId },
      orderBy: { watchedAt: "desc" },
      take: limit,
      select: { id: true, coins: true, watchedAt: true },
    }),
    prisma.adReward.count({
      where: { userId, watchedAt: { gte: todayStart } },
    }),
  ]);

  return {
    rewards,
    todayCount,
    dailyLimit: config.maxDailyRewards,
  };
}

// ─── Analytics ───────────────────────────────────────────────────────

/**
 * Get ad analytics for admin dashboard
 */
export async function getAdAnalytics(params: {
  startDate?: string;
  endDate?: string;
  placement?: string;
}): Promise<{
  summary: {
    totalImpressions: number;
    totalRewards: number;
    totalCoins: number;
    uniqueUsers: number;
  };
  dailyStats: Array<{
    date: string;
    placement: string;
    impressions: number;
    rewards: number;
    coins: number;
  }>;
}> {
  const { startDate, endDate, placement } = params;
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  const start = startDate || defaultStart.toISOString().slice(0, 10);
  const end = endDate || now.toISOString().slice(0, 10);

  const whereClause: Record<string, unknown> = {
    date: { gte: start, lte: end },
  };
  if (placement) {
    whereClause.placement = placement;
  }

  const stats = await prisma.adAnalytics.findMany({
    where: whereClause,
    orderBy: { date: "desc" },
  });

  // Calculate summary
  const summary = stats.reduce(
    (acc, stat) => ({
      totalImpressions: acc.totalImpressions + stat.impressions,
      totalRewards: acc.totalRewards + stat.rewardsClaimed,
      totalCoins: acc.totalCoins + stat.coinsDistributed,
      uniqueUsers: acc.uniqueUsers + stat.uniqueUsers,
    }),
    { totalImpressions: 0, totalRewards: 0, totalCoins: 0, uniqueUsers: 0 }
  );

  // Get unique users from impressions
  const uniqueUsers = await prisma.adImpression.findMany({
    where: {
      impressionTime: { gte: new Date(start), lte: new Date(end) },
      userId: { not: null },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  summary.uniqueUsers = uniqueUsers.length;

  return {
    summary,
    dailyStats: stats.map((s) => ({
      date: s.date,
      placement: s.placement,
      impressions: s.impressions,
      rewards: s.rewardsClaimed,
      coins: s.coinsDistributed,
    })),
  };
}

/**
 * Initialize default ad placements if they don't exist
 */
export async function initializeDefaultPlacements(): Promise<void> {
  const defaultPlacements: Array<{
    location: string;
    adNetwork: string;
    adUnitId: string;
    priority: number;
  }> = [
    { location: "banner_top", adNetwork: "google", adUnitId: FALLBACK_AD_UNITS.banner_top, priority: 100 },
    { location: "banner_sidebar", adNetwork: "google", adUnitId: FALLBACK_AD_UNITS.banner_sidebar, priority: 90 },
    { location: "banner_footer", adNetwork: "google", adUnitId: FALLBACK_AD_UNITS.banner_footer, priority: 80 },
    { location: "in_content", adNetwork: "google", adUnitId: FALLBACK_AD_UNITS.in_content, priority: 70 },
    { location: "reward_video", adNetwork: "google", adUnitId: FALLBACK_AD_UNITS.reward_video, priority: 60 },
  ];

  for (const placement of defaultPlacements) {
    await prisma.adPlacement.upsert({
      where: { location: placement.location },
      update: {},
      create: placement,
    });
  }
}
