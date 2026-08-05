import { Router, Response, Request } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";
import { invalidateCache } from "../lib/cache";

const router = Router();

const COINS_PER_SUGGESTION = 50;
const MAX_SUGGESTIONS_PER_DAY = 3;
const MAX_BOOST_PER_DAY = 10; // B6: max boost (50đ/lần) per user per day
const SUGGESTION_DURATION_DAYS = 7;

function getTodayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getDaysLater(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// ─── POST /api/suggestions/promote ───
// Pay 50 coins to suggest a story for homepage promotion
router.post("/promote", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { storyId, message } = req.body;

    if (!storyId) {
      return res.status(400).json({ error: "storyId là bắt buộc" });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Check balance
    if (user.coinBalance < COINS_PER_SUGGESTION) {
      return res.status(400).json({
        error: "Số dư không đủ",
        required: COINS_PER_SUGGESTION,
        current: user.coinBalance
      });
    }

    // Check story exists and is approved
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, title: true, approvalStatus: true, slug: true }
    });
    if (!story) return res.status(404).json({ error: "Truyện không tồn tại" });
    if (story.approvalStatus !== "approved") {
      return res.status(400).json({ error: "Chỉ có thể đề xuất truyện đã được duyệt" });
    }

    // Anti-spam: Check max suggestions per user per day
    const todayStart = getTodayStart();
    const suggestionsToday = await prisma.paidSuggestion.count({
      where: {
        userId: user.id,
        createdAt: { gte: todayStart }
      }
    });
    if (suggestionsToday >= MAX_SUGGESTIONS_PER_DAY) {
      return res.status(429).json({
        error: `Bạn đã đề xuất tối đa ${MAX_SUGGESTIONS_PER_DAY} truyện trong hôm nay. Vui lòng thử lại ngày mai.`,
        maxPerDay: MAX_SUGGESTIONS_PER_DAY
      });
    }

    // Check if user already has a pending suggestion for this story
    const existingPending = await prisma.paidSuggestion.findFirst({
      where: {
        userId: user.id,
        storyId,
        status: "pending"
      }
    });
    if (existingPending) {
      return res.status(400).json({ error: "Bạn đã có đề xuất đang chờ duyệt cho truyện này" });
    }

    // Deduct coins and create suggestion in transaction
    const expiresAt = getDaysLater(SUGGESTION_DURATION_DAYS);

    const [suggestion] = await prisma.$transaction([
      prisma.paidSuggestion.create({
        data: {
          userId: user.id,
          storyId,
          message: message || null,
          coinsSpent: COINS_PER_SUGGESTION,
          status: "pending",
          expiresAt
        },
        include: {
          story: { select: { id: true, title: true, slug: true } }
        }
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { coinBalance: { decrement: COINS_PER_SUGGESTION } }
      })
    ]);

    // Notify admins (fire-and-forget)
    prisma.notification.create({
      data: {
        userId: user.id,
        title: "Đề xuất đã được gửi",
        message: `Bạn đã đề xuất truyện "${story.title}" lên trang chủ. Đề xuất đang chờ duyệt.`,
        type: "system",
        link: "/suggest"
      }
    }).catch(() => {});

    // Invalidate wallet cache
    invalidateCache(`wallet:${user.email}`, `wallet:balance:${user.email}`, `wallet:history:${user.email}`);

    res.status(201).json({
      success: true,
      suggestion,
      coinsSpent: COINS_PER_SUGGESTION,
      newBalance: user.coinBalance - COINS_PER_SUGGESTION
    });
  } catch (error) {
    console.error("Error promoting story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/suggestions/pool ───
// Get today's suggestion pool (featured stories of the day)
router.get("/pool", async (_req, res: Response) => {
  try {
    const todayStart = getTodayStart();
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    // Get or create today's pool
    let pool = await prisma.suggestionPool.findUnique({
      where: { date: todayStart }
    });

    if (!pool) {
      // Create new pool for today
      pool = await prisma.suggestionPool.create({
        data: {
          date: todayStart,
          slots: 5,
          stories: []
        }
      });
    }

    // Get approved suggestions for today
    const approvedSuggestions = await prisma.paidSuggestion.findMany({
      where: {
        status: "approved",
        createdAt: {
          gte: todayStart,
          lt: todayEnd
        }
      },
      orderBy: { createdAt: "asc" },
      take: pool.slots,
      include: {
        story: {
          select: {
            id: true,
            title: true,
            slug: true,
            coverImage: true,
            author: { select: { id: true, name: true } },
            views: true,
            likes: true,
            genre: true
          }
        }
      }
    });

    res.json({
      date: todayStart.toISOString().split("T")[0],
      slots: pool.slots,
      stories: approvedSuggestions.map(s => ({
        ...s.story,
        suggestedAt: s.createdAt,
        message: s.message
      })),
      total: approvedSuggestions.length
    });
  } catch (error) {
    console.error("Error fetching suggestion pool:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/suggestions/me ───
// Get user's suggestion history
router.get("/me", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true }
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const suggestions = await prisma.paidSuggestion.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        story: {
          select: {
            id: true,
            title: true,
            slug: true,
            coverImage: true,
            author: { select: { id: true, name: true } }
          }
        }
      }
    });

    // Calculate today's count for anti-spam
    const todayStart = getTodayStart();
    const todayCount = await prisma.paidSuggestion.count({
      where: {
        userId: user.id,
        createdAt: { gte: todayStart }
      }
    });

    res.json({
      suggestions,
      todayCount,
      maxPerDay: MAX_SUGGESTIONS_PER_DAY,
      remainingToday: Math.max(0, MAX_SUGGESTIONS_PER_DAY - todayCount),
      coinsPerSuggestion: COINS_PER_SUGGESTION
    });
  } catch (error) {
    console.error("Error fetching user suggestions:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/suggestions/boost/:storyId ────────────────────────────────────
// B6: Pay 50 coins to instantly boost a story on the homepage ranking.
// Unlike /promote (admin-approved, daily pool), /boost is immediate and stackable:
// each call increments Story.boostScore by 1, which the recommendation engine
// uses as a tiebreaker / boost multiplier. Capped at MAX_BOOST_PER_DAY per user.
router.post("/boost/:storyId", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { storyId } = req.params;

    if (!storyId) {
      return res.status(400).json({ error: "storyId là bắt buộc" });
    }

    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.coinBalance < COINS_PER_SUGGESTION) {
      return res.status(400).json({
        error: "Số dư không đủ",
        required: COINS_PER_SUGGESTION,
        current: user.coinBalance,
      });
    }

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, title: true, slug: true, approvalStatus: true },
    });
    if (!story) return res.status(404).json({ error: "Truyện không tồn tại" });
    if (story.approvalStatus !== "approved") {
      return res.status(400).json({ error: "Chỉ có thể đề cử truyện đã được duyệt" });
    }

    // B6: limit boosts per user per day (more lenient than /promote, which is admin-gated)
    const todayStart = getTodayStart();
    const boostsToday = await prisma.paidSuggestion.count({
      where: {
        userId: user.id,
        storyId,
        status: "boosted",
        createdAt: { gte: todayStart },
      },
    });
    if (boostsToday >= MAX_BOOST_PER_DAY) {
      return res.status(429).json({
        error: `Bạn đã đề cử tối đa ${MAX_BOOST_PER_DAY} lần cho truyện này hôm nay. Vui lòng thử lại ngày mai.`,
        maxPerDay: MAX_BOOST_PER_DAY,
      });
    }

    // Atomic: deduct coins, record boost, increment story.boostScore
    const [, updatedStory] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { coinBalance: { decrement: COINS_PER_SUGGESTION } },
      }),
      prisma.paidSuggestion.create({
        data: {
          userId: user.id,
          storyId,
          message: "boost",
          coinsSpent: COINS_PER_SUGGESTION,
          status: "boosted",
          expiresAt: getDaysLater(SUGGESTION_DURATION_DAYS),
        },
      }),
      prisma.story.update({
        where: { id: storyId },
        data: {
          boostScore: { increment: 1 },
          boostedAt: new Date(),
        },
      }),
    ]);

    // Invalidate recommendations + ranking cache so boost takes effect on next request
    invalidateCache(
      "rec:trending:",
      "rec:hotByCategory:",
      "rec:new:",
      "rec:home:",
      "rec:personalized:",
      "rec:similar:",
      "ranking:",
      "ranking:trending:",
      `story:${story.slug}`,
    );

    const freshUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { coinBalance: true },
    });

    res.status(201).json({
      success: true,
      boosted: true,
      coinsSpent: COINS_PER_SUGGESTION,
      newBalance: freshUser?.coinBalance ?? (user.coinBalance - COINS_PER_SUGGESTION),
      storyId,
      newBoostScore: updatedStory ? (updatedStory as any).boostScore : undefined,
      remainingToday: MAX_BOOST_PER_DAY - boostsToday - 1,
    });
  } catch (error) {
    console.error("Error boosting story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/suggestions/boost-count/:storyId ──────────────────────────────
// B6: Return current boost count + rank position for a story.
router.get("/boost-count/:storyId", async (req: Request, res: Response) => {
  try {
    const { storyId } = req.params;
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, boostScore: true, boostedAt: true, slug: true, title: true },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });

    // Count active boosts (status=boosted, not expired)
    const now = new Date();
    const activeCount = await prisma.paidSuggestion.count({
      where: {
        storyId,
        status: "boosted",
        expiresAt: { gte: now },
      },
    });

    // Rank position: stories with higher boostScore
    const rankPosition = await prisma.story.count({
      where: {
        approvalStatus: "approved",
        boostScore: { gt: story.boostScore },
      },
    });

    res.json({
      storyId: story.id,
      title: story.title,
      slug: story.slug,
      boostScore: story.boostScore,
      activeBoostCount: activeCount,
      rankPosition: rankPosition + 1, // 1-indexed
      boostedAt: story.boostedAt,
    });
  } catch (error) {
    console.error("Error fetching boost count:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/suggestions/boost-leaderboard ─────────────────────────────────
// B6: Top boosted stories for homepage ranking display.
router.get("/boost-leaderboard", async (_req: Request, res: Response) => {
  try {
    const stories = await prisma.story.findMany({
      where: {
        approvalStatus: "approved",
        boostScore: { gt: 0 },
      },
      orderBy: [{ boostScore: "desc" }, { boostedAt: "desc" }],
      take: 20,
      select: {
        id: true,
        title: true,
        slug: true,
        coverImage: true,
        boostScore: true,
        boostedAt: true,
        views: true,
        likes: true,
        genre: true,
        author: { select: { id: true, name: true, image: true } },
      },
    });

    res.json({
      stories: stories.map((s, i) => ({
        rank: i + 1,
        ...s,
      })),
      total: stories.length,
    });
  } catch (error) {
    console.error("Error fetching boost leaderboard:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/suggestions/cancel/:id ───
// Cancel a pending suggestion (refund)
router.post("/cancel/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const suggestion = await prisma.paidSuggestion.findUnique({
      where: { id }
    });

    if (!suggestion) {
      return res.status(404).json({ error: "Đề xuất không tồn tại" });
    }

    if (suggestion.userId !== user.id) {
      return res.status(403).json({ error: "Bạn không có quyền hủy đề xuất này" });
    }

    if (suggestion.status !== "pending") {
      return res.status(400).json({ error: "Chỉ có thể hủy đề xuất đang chờ duyệt" });
    }

    // Refund and update status in transaction
    await prisma.$transaction([
      prisma.paidSuggestion.update({
        where: { id },
        data: { status: "cancelled" }
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { coinBalance: { increment: suggestion.coinsSpent } }
      })
    ]);

    // Invalidate cache
    invalidateCache(`wallet:${user.email}`, `wallet:balance:${user.email}`, `wallet:history:${user.email}`);

    res.json({ success: true, refunded: suggestion.coinsSpent });
  } catch (error) {
    console.error("Error cancelling suggestion:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/suggestions/spam/:id ───
// Admin: Mark suggestion as spam (refund)
router.delete("/spam/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check admin/moderator role
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true, role: true }
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role !== "admin" && user.role !== "moderator") {
      return res.status(403).json({ error: "Chỉ admin/moderator mới có quyền thực hiện" });
    }

    const suggestion = await prisma.paidSuggestion.findUnique({
      where: { id },
      include: { user: { select: { email: true, coinBalance: true } } }
    });

    if (!suggestion) {
      return res.status(404).json({ error: "Đề xuất không tồn tại" });
    }

    // Refund and update status
    await prisma.$transaction([
      prisma.paidSuggestion.update({
        where: { id },
        data: { status: "spam" }
      }),
      prisma.user.update({
        where: { id: suggestion.userId },
        data: { coinBalance: { increment: suggestion.coinsSpent } }
      })
    ]);

    // Notify user
    prisma.notification.create({
      data: {
        userId: suggestion.userId,
        title: "Đề xuất bị hủy do spam",
        message: `Đề xuất truyện của bạn đã bị hủy do vi phạm. ${suggestion.coinsSpent} xu đã được hoàn trả.`,
        type: "system",
        link: "/suggest"
      }
    }).catch(() => {});

    // Invalidate user cache
    invalidateCache(`wallet:${suggestion.user.email}`, `wallet:balance:${suggestion.user.email}`, `wallet:history:${suggestion.user.email}`);

    res.json({ success: true, refunded: suggestion.coinsSpent });
  } catch (error) {
    console.error("Error marking spam:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/suggestions/approve/:id ───
// Admin: Approve a suggestion
router.post("/approve/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { role: true }
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role !== "admin" && user.role !== "moderator") {
      return res.status(403).json({ error: "Chỉ admin/moderator mới có quyền thực hiện" });
    }

    const suggestion = await prisma.paidSuggestion.findUnique({
      where: { id }
    });

    if (!suggestion) {
      return res.status(404).json({ error: "Đề xuất không tồn tại" });
    }

    if (suggestion.status !== "pending") {
      return res.status(400).json({ error: "Chỉ có thể duyệt đề xuất đang chờ" });
    }

    // Update status
    await prisma.paidSuggestion.update({
      where: { id },
      data: { status: "approved" }
    });

    // Update today's pool
    const todayStart = getTodayStart();
    await prisma.suggestionPool.upsert({
      where: { date: todayStart },
      update: {
        stories: { push: suggestion.storyId }
      },
      create: {
        date: todayStart,
        slots: 5,
        stories: [suggestion.storyId]
      }
    });

    // Notify user
    prisma.notification.create({
      data: {
        userId: suggestion.userId,
        title: "Đề xuất đã được duyệt!",
        message: `Đề xuất truyện của bạn đã được duyệt và hiển thị trên trang chủ.`,
        type: "system",
        link: "/suggest"
      }
    }).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    console.error("Error approving suggestion:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/suggestions/reject/:id ───
// Admin: Reject a suggestion
router.post("/reject/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { role: true }
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role !== "admin" && user.role !== "moderator") {
      return res.status(403).json({ error: "Chỉ admin/moderator mới có quyền thực hiện" });
    }

    const suggestion = await prisma.paidSuggestion.findUnique({
      where: { id }
    });

    if (!suggestion) {
      return res.status(404).json({ error: "Đề xuất không tồn tại" });
    }

    if (suggestion.status !== "pending") {
      return res.status(400).json({ error: "Chỉ có thể từ chối đề xuất đang chờ" });
    }

    // Refund and update status
    await prisma.$transaction([
      prisma.paidSuggestion.update({
        where: { id },
        data: { status: "rejected" }
      }),
      prisma.user.update({
        where: { id: suggestion.userId },
        data: { coinBalance: { increment: suggestion.coinsSpent } }
      })
    ]);

    // Notify user
    prisma.notification.create({
      data: {
        userId: suggestion.userId,
        title: "Đề xuất bị từ chối",
        message: `Đề xuất truyện của bạn đã bị từ chối. ${suggestion.coinsSpent} xu đã được hoàn trả.${reason ? ` Lý do: ${reason}` : ""}`,
        type: "system",
        link: "/suggest"
      }
    }).catch(() => {});

    // Invalidate user cache
    const suggestionUser = await prisma.user.findUnique({
      where: { id: suggestion.userId },
      select: { email: true }
    });
    if (suggestionUser) {
      invalidateCache(`wallet:${suggestionUser.email}`, `wallet:balance:${suggestionUser.email}`, `wallet:history:${suggestionUser.email}`);
    }

    res.json({ success: true, refunded: suggestion.coinsSpent });
  } catch (error) {
    console.error("Error rejecting suggestion:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
