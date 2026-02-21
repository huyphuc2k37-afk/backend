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
};
const MAX_DAILY = 50;

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

export default router;
