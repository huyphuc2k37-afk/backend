import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ─── GET /api/revenue — thống kê doanh thu tác giả ──
router.get("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role !== "author" && user.role !== "admin") {
      return res.status(403).json({ error: "Author only" });
    }

    // Tổng xu hiện có (rút được)
    const balance = user.coinBalance;

    // Tổng doanh thu (tất cả purchases vào chương của tác giả)
    const authorStories = await prisma.story.findMany({
      where: { authorId: user.id },
      select: { id: true },
    });
    const storyIds = authorStories.map((s) => s.id);

    const allPurchases = await prisma.chapterPurchase.findMany({
      where: {
        chapter: { storyId: { in: storyIds } },
      },
      include: {
        chapter: {
          select: { title: true, number: true, price: true, storyId: true, story: { select: { title: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // 70% tác giả
    const totalRevenue = allPurchases.reduce((sum, p) => sum + Math.floor(p.coins * 0.7), 0);

    // Doanh thu tháng này
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const thisMonthPurchases = allPurchases.filter((p) => p.createdAt >= startOfMonth);
    const thisMonthRevenue = thisMonthPurchases.reduce((sum, p) => sum + Math.floor(p.coins * 0.7), 0);

    // Tổng số chương đã bán
    const totalChaptersSold = allPurchases.length;

    // Doanh thu theo truyện
    const revenueByStory: Record<string, { title: string; sold: number; revenue: number }> = {};
    for (const p of allPurchases) {
      const sid = p.chapter.storyId;
      if (!revenueByStory[sid]) {
        revenueByStory[sid] = { title: p.chapter.story.title, sold: 0, revenue: 0 };
      }
      revenueByStory[sid].sold++;
      revenueByStory[sid].revenue += Math.floor(p.coins * 0.7);
    }
    const topStories = Object.values(revenueByStory).sort((a, b) => b.revenue - a.revenue);

    // Pending withdrawals
    const pendingWithdraw = await prisma.withdrawal.aggregate({
      where: { userId: user.id, status: "pending" },
      _sum: { amount: true },
    });

    res.json({
      balance,
      totalRevenue,
      thisMonthRevenue,
      totalChaptersSold,
      pendingWithdraw: pendingWithdraw._sum.amount || 0,
      topStories,
      recentSales: allPurchases.slice(0, 20).map((p) => ({
        id: p.id,
        coins: Math.floor(p.coins * 0.7),
        chapterTitle: p.chapter.title,
        storyTitle: p.chapter.story.title,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching revenue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/revenue/withdrawals — lịch sử rút tiền ──
router.get("/withdrawals", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    res.json({ balance: user.coinBalance, withdrawals });
  } catch (error) {
    console.error("Error fetching withdrawals:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/revenue/withdraw — yêu cầu rút tiền ──
router.post("/withdraw", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role !== "author" && user.role !== "admin") {
      return res.status(403).json({ error: "Author only" });
    }

    const { amount, bankName, bankAccount, bankHolder } = req.body;

    if (!amount || !bankName || !bankAccount || !bankHolder) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (amount < 50000) {
      return res.status(400).json({ error: "Minimum withdrawal is 50,000 xu" });
    }

    if (user.coinBalance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Quy đổi: 1 xu = 1 VNĐ
    const moneyAmount = amount;

    // Trừ xu tạm thời khi yêu cầu rút
    const [withdrawal] = await prisma.$transaction([
      prisma.withdrawal.create({
        data: {
          amount,
          moneyAmount,
          bankName,
          bankAccount,
          bankHolder,
          userId: user.id,
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { coinBalance: { decrement: amount } },
      }),
    ]);

    res.json(withdrawal);
  } catch (error) {
    console.error("Error creating withdrawal:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
