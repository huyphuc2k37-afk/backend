import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ── Helpers ──────────────────────────────────────
function todayStr(): string {
  // Vietnam timezone (UTC+7)
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

const QUEST_REWARDS = {
  checkin: 20,
  comment: 10,
  read: 20,
  watchAd: 10, // 10 xu per ad, up to 5 ads/day = 50 xu
};
const AD_WATCH_MAX = 5; // Maximum ads per day
const AD_COOLDOWN_SECONDS = 15; // Must watch ad for at least 15 seconds
const MAX_DAILY = 100;

async function getOrCreateDailyQuest(userId: string, date: string) {
  return prisma.dailyQuest.upsert({
    where: { userId_date: { userId, date } },
    create: { id: require("crypto").randomUUID(), userId, date },
    update: {},
  });
}

// ── GET /api/quests/daily — Get today's quest status ──
router.get("/daily", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const date = todayStr();
    const quest = await getOrCreateDailyQuest(user.id, date);

    res.json({
      date,
      quests: [
        {
          id: "checkin",
          title: "Điểm danh hàng ngày",
          description: "Nhấn nút điểm danh để nhận xu",
          reward: QUEST_REWARDS.checkin,
          completed: quest.checkin,
        },
        {
          id: "comment",
          title: "Bình luận 1 chương truyện",
          description: "Bình luận bất kỳ chương truyện nào",
          reward: QUEST_REWARDS.comment,
          completed: quest.commented,
        },
        {
          id: "read",
          title: "Đọc truyện 10 phút",
          description: "Đọc truyện tối thiểu 10 phút",
          reward: QUEST_REWARDS.read,
          completed: quest.readCompleted,
          progress: Math.min(quest.readMinutes, 10),
          target: 10,
        },
        {
          id: "watchAd",
          title: "Xem quảng cáo nhận xu",
          description: `Xem quảng cáo để nhận ${QUEST_REWARDS.watchAd} xu mỗi lần`,
          reward: QUEST_REWARDS.watchAd,
          completed: quest.adsWatched >= AD_WATCH_MAX,
          progress: quest.adsWatched,
          target: AD_WATCH_MAX,
        },
      ],
      coinsEarned: quest.coinsEarned,
      maxDaily: MAX_DAILY,
    });
  } catch (error) {
    console.error("Error fetching daily quests:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/quests/checkin — Daily check-in ──
router.post("/checkin", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const date = todayStr();
    const quest = await getOrCreateDailyQuest(user.id, date);

    if (quest.checkin) {
      return res.status(400).json({ error: "Bạn đã điểm danh hôm nay rồi" });
    }

    if (quest.coinsEarned + QUEST_REWARDS.checkin > MAX_DAILY) {
      return res.status(400).json({ error: "Đã đạt giới hạn xu nhiệm vụ hôm nay" });
    }

    // Update quest + add coins in transaction
    const [updatedQuest] = await prisma.$transaction([
      prisma.dailyQuest.update({
        where: { userId_date: { userId: user.id, date } },
        data: {
          checkin: true,
          coinsEarned: { increment: QUEST_REWARDS.checkin },
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { coinBalance: { increment: QUEST_REWARDS.checkin } },
      }),
    ]);

    res.json({
      success: true,
      reward: QUEST_REWARDS.checkin,
      coinsEarned: updatedQuest.coinsEarned,
      message: `Điểm danh thành công! +${QUEST_REWARDS.checkin} xu`,
    });
  } catch (error) {
    console.error("Error checking in:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/quests/read — Track reading time ──
router.post("/read", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { minutes } = req.body;
    const addMinutes = Math.min(Math.max(Math.floor(Number(minutes) || 0), 1), 5); // 1-5 min per call, prevent abuse

    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const date = todayStr();
    const quest = await getOrCreateDailyQuest(user.id, date);

    if (quest.readCompleted) {
      return res.json({ success: true, alreadyCompleted: true, readMinutes: quest.readMinutes });
    }

    const newMinutes = Math.min(quest.readMinutes + addMinutes, 10);
    const justCompleted = newMinutes >= 10 && !quest.readCompleted;

    if (justCompleted && quest.coinsEarned + QUEST_REWARDS.read > MAX_DAILY) {
      // Still track reading but can't get reward if daily limit reached
      await prisma.dailyQuest.update({
        where: { userId_date: { userId: user.id, date } },
        data: { readMinutes: newMinutes },
      });
      return res.json({ success: true, readMinutes: newMinutes, completed: false, limitReached: true });
    }

    if (justCompleted) {
      const [updatedQuest] = await prisma.$transaction([
        prisma.dailyQuest.update({
          where: { userId_date: { userId: user.id, date } },
          data: {
            readMinutes: newMinutes,
            readCompleted: true,
            coinsEarned: { increment: QUEST_REWARDS.read },
          },
        }),
        prisma.user.update({
          where: { id: user.id },
          data: { coinBalance: { increment: QUEST_REWARDS.read } },
        }),
      ]);
      return res.json({
        success: true,
        readMinutes: newMinutes,
        completed: true,
        reward: QUEST_REWARDS.read,
        coinsEarned: updatedQuest.coinsEarned,
        message: `Đọc truyện 10 phút hoàn thành! +${QUEST_REWARDS.read} xu`,
      });
    }

    // Not yet completed — just update reading minutes
    await prisma.dailyQuest.update({
      where: { userId_date: { userId: user.id, date } },
      data: { readMinutes: newMinutes },
    });

    res.json({ success: true, readMinutes: newMinutes, completed: false });
  } catch (error) {
    console.error("Error tracking reading:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/quests/complete-comment — Called internally after comment ──
// This endpoint is called by the comments route after a successful comment
router.post("/complete-comment", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const date = todayStr();
    const quest = await getOrCreateDailyQuest(user.id, date);

    if (quest.commented) {
      return res.json({ success: true, alreadyCompleted: true });
    }

    if (quest.coinsEarned + QUEST_REWARDS.comment > MAX_DAILY) {
      return res.json({ success: true, limitReached: true });
    }

    const [updatedQuest] = await prisma.$transaction([
      prisma.dailyQuest.update({
        where: { userId_date: { userId: user.id, date } },
        data: {
          commented: true,
          coinsEarned: { increment: QUEST_REWARDS.comment },
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { coinBalance: { increment: QUEST_REWARDS.comment } },
      }),
    ]);

    res.json({
      success: true,
      reward: QUEST_REWARDS.comment,
      coinsEarned: updatedQuest.coinsEarned,
      message: `Nhiệm vụ bình luận hoàn thành! +${QUEST_REWARDS.comment} xu`,
    });
  } catch (error) {
    console.error("Error completing comment quest:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/quests/watch-ad — Reward user for watching an ad ──
// Server validates minimum watch time to prevent abuse
const adWatchTimestamps = new Map<string, number>(); // userId -> timestamp when ad was started

router.post("/watch-ad/start", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const date = todayStr();
    const quest = await getOrCreateDailyQuest(user.id, date);

    if (quest.adsWatched >= AD_WATCH_MAX) {
      return res.status(400).json({ error: "Đã xem đủ quảng cáo hôm nay" });
    }

    // Store start timestamp for validation
    adWatchTimestamps.set(user.id, Date.now());

    res.json({
      success: true,
      cooldownSeconds: AD_COOLDOWN_SECONDS,
      adsWatched: quest.adsWatched,
      adsMax: AD_WATCH_MAX,
    });
  } catch (error) {
    console.error("Error starting ad watch:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/watch-ad/complete", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Validate that user actually started watching
    const startTime = adWatchTimestamps.get(user.id);
    if (!startTime) {
      return res.status(400).json({ error: "Phiên xem quảng cáo không hợp lệ" });
    }

    // Validate minimum watch time (allow 2s tolerance for network latency)
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed < AD_COOLDOWN_SECONDS - 2) {
      return res.status(400).json({ error: "Chưa xem đủ thời gian quảng cáo" });
    }

    // Clean up
    adWatchTimestamps.delete(user.id);

    const date = todayStr();
    const quest = await getOrCreateDailyQuest(user.id, date);

    if (quest.adsWatched >= AD_WATCH_MAX) {
      return res.status(400).json({ error: "Đã xem đủ quảng cáo hôm nay" });
    }

    if (quest.coinsEarned + QUEST_REWARDS.watchAd > MAX_DAILY) {
      return res.status(400).json({ error: "Đã đạt giới hạn xu nhiệm vụ hôm nay" });
    }

    const newAdsWatched = quest.adsWatched + 1;

    const [updatedQuest] = await prisma.$transaction([
      prisma.dailyQuest.update({
        where: { userId_date: { userId: user.id, date } },
        data: {
          adsWatched: newAdsWatched,
          coinsEarned: { increment: QUEST_REWARDS.watchAd },
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { coinBalance: { increment: QUEST_REWARDS.watchAd } },
      }),
    ]);

    res.json({
      success: true,
      reward: QUEST_REWARDS.watchAd,
      adsWatched: newAdsWatched,
      adsMax: AD_WATCH_MAX,
      completed: newAdsWatched >= AD_WATCH_MAX,
      coinsEarned: updatedQuest.coinsEarned,
      message: `Xem quảng cáo thành công! +${QUEST_REWARDS.watchAd} xu (${newAdsWatched}/${AD_WATCH_MAX})`,
    });
  } catch (error) {
    console.error("Error completing ad watch:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
