import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";
import { notifyNewWithdrawal } from "../lib/telegram";
import { splitRevenue } from "../lib/revenueSplit";
import type { PrismaClient as GeneratedPrismaClient } from ".prisma/client";

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

    // Period filter: 7d, 30d, all
    const period = (req.query.period as string) || "all";
    let periodFilter: Date | undefined;
    if (period === "7d") {
      periodFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === "30d") {
      periodFilter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    const dateWhere = periodFilter ? { createdAt: { gte: periodFilter } } : {};

    // Lấy earnings theo period (limit 500 for recentSales and breakdown)
    const allEarnings = await prisma.authorEarning.findMany({
      where: { authorId: user.id, ...dateWhere },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    // Tổng doanh thu (tất cả thời gian)
    const totalEarningsAll = await prisma.authorEarning.aggregate({
      where: { authorId: user.id },
      _sum: { amount: true },
    });
    const totalRevenue = totalEarningsAll._sum.amount || 0;

    // Doanh thu theo period
    const periodRevenue = allEarnings.reduce((sum, e) => sum + e.amount, 0);

    // Doanh thu tháng này
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const thisMonthEarnings = await prisma.authorEarning.aggregate({
      where: { authorId: user.id, createdAt: { gte: startOfMonth } },
      _sum: { amount: true },
    });
    const thisMonthRevenue = thisMonthEarnings._sum.amount || 0;

    // Tổng doanh thu từ mua chương
    const purchaseRevenue = await prisma.authorEarning.aggregate({
      where: { authorId: user.id, type: "purchase" },
      _sum: { amount: true },
      _count: true,
    });

    // Tổng doanh thu từ tip
    const tipRevenue = await prisma.authorEarning.aggregate({
      where: { authorId: user.id, type: "tip" },
      _sum: { amount: true },
      _count: true,
    });

    const totalChaptersSold = purchaseRevenue._count || 0;
    const totalTips = tipRevenue._count || 0;

    // Doanh thu theo truyện
    const revenueByStory: Record<string, { title: string; purchases: number; tips: number; revenue: number }> = {};
    for (const e of allEarnings) {
      const sid = e.storyId || "unknown";
      if (!revenueByStory[sid]) {
        revenueByStory[sid] = { title: e.storyTitle || "Không xác định", purchases: 0, tips: 0, revenue: 0 };
      }
      if (e.type === "purchase") revenueByStory[sid].purchases++;
      if (e.type === "tip") revenueByStory[sid].tips++;
      revenueByStory[sid].revenue += e.amount;
    }
    const topStories = Object.values(revenueByStory).sort((a, b) => b.revenue - a.revenue);

    // Pending withdrawals
    const pendingWithdraw = await prisma.withdrawal.aggregate({
      where: { userId: user.id, status: "pending" },
      _sum: { amount: true },
    });

    // Hoa hồng giới thiệu
    const referralEarningsTotal = await prisma.referralEarning.aggregate({
      where: { referrerId: user.id },
      _sum: { amount: true },
    });
    const referralRevenue = referralEarningsTotal._sum.amount || 0;

    // Doanh thu theo ngày (chart 30 ngày)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dailyEarnings = await prisma.authorEarning.findMany({
      where: { authorId: user.id, createdAt: { gte: thirtyDaysAgo } },
      select: { amount: true, createdAt: true, type: true },
      orderBy: { createdAt: "asc" },
    });

    const dailyMap: Record<string, { purchases: number; tips: number; total: number }> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyMap[key] = { purchases: 0, tips: 0, total: 0 };
    }
    for (const e of dailyEarnings) {
      const key = e.createdAt.toISOString().slice(0, 10);
      if (dailyMap[key]) {
        if (e.type === "purchase") dailyMap[key].purchases += e.amount;
        else dailyMap[key].tips += e.amount;
        dailyMap[key].total += e.amount;
      }
    }
    const dailyChart = Object.entries(dailyMap).map(([date, data]) => ({
      date,
      day: new Date(date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }),
      ...data,
    }));

    res.json({
      balance,
      totalRevenue,
      periodRevenue,
      thisMonthRevenue,
      totalChaptersSold,
      totalTips,
      purchaseRevenue: purchaseRevenue._sum.amount || 0,
      tipRevenue: tipRevenue._sum.amount || 0,
      pendingWithdraw: pendingWithdraw._sum.amount || 0,
      referralRevenue,
      topStories,
      dailyChart,
      recentSales: allEarnings.slice(0, 30).map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount,
        storyTitle: e.storyTitle || "",
        chapterTitle: e.chapterTitle || "",
        createdAt: e.createdAt,
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
    if (user.role !== "author" && user.role !== "admin") {
      return res.status(403).json({ error: "Author only" });
    }

    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
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

    const { amount: rawAmount, bankName, bankAccount, bankHolder } = req.body;

    if (!rawAmount || !bankName || !bankAccount || !bankHolder) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const amount = typeof rawAmount === "string" ? parseInt(rawAmount, 10) : rawAmount;
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 50000) {
      return res.status(400).json({ error: "Minimum withdrawal is 50,000 xu" });
    }

    if (user.coinBalance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Quy đổi: 1 xu = 1 VNĐ
    const moneyAmount = amount;

    // Trừ xu tạm thời khi yêu cầu rút — dùng interactive transaction để chống race condition
    let withdrawal: any;
    try {
      withdrawal = await prisma.$transaction(async (tx) => {
        const freshUser = await tx.user.findUnique({ where: { id: user.id }, select: { coinBalance: true } });
        if (!freshUser || freshUser.coinBalance < amount) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        const w = await tx.withdrawal.create({
          data: {
            amount,
            moneyAmount,
            bankName,
            bankAccount,
            bankHolder,
            userId: user.id,
          },
        });
        await tx.user.update({
          where: { id: user.id },
          data: { coinBalance: { decrement: amount } },
        });
        return w;
      });
    } catch (txError: any) {
      if (txError.message === "INSUFFICIENT_BALANCE") {
        return res.status(400).json({ error: "Insufficient balance" });
      }
      throw txError;
    }

    // Notify admin via Telegram (fire-and-forget)
    notifyNewWithdrawal({
      ...withdrawal,
      user: { name: user.name, email: user.email },
    }).catch(() => {});

    res.json(withdrawal);
  } catch (error) {
    console.error("Error creating withdrawal:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/revenue/migrate — di chuyển dữ liệu cũ sang AuthorEarning (admin, chạy 1 lần) ──
router.post("/migrate", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin only" });

    const prismaWithPlatform = prisma as unknown as GeneratedPrismaClient;

    const allPurchases = await prisma.chapterPurchase.findMany({
      include: {
        chapter: {
          select: {
            title: true, storyId: true, price: true,
            story: { select: { title: true, authorId: true } },
          },
        },
      },
    });

    let migrated = 0;
    for (const p of allPurchases) {
      const split = splitRevenue(p.coins);

      const exists = await prisma.authorEarning.findFirst({
        where: {
          authorId: p.chapter.story.authorId,
          chapterId: p.chapterId,
          fromUserId: p.userId,
          type: "purchase",
        },
      });

      const platformExists = await prismaWithPlatform.platformEarning.findFirst({
        where: {
          type: "purchase",
          chapterId: p.chapterId,
          fromUserId: p.userId,
        },
      });

      if (exists && platformExists) continue;

      await prisma.$transaction([
        ...(exists
          ? []
          : [
              prisma.authorEarning.create({
                data: {
                  type: "purchase",
                  amount: split.author,
                  authorId: p.chapter.story.authorId,
                  fromUserId: p.userId,
                  chapterId: p.chapterId,
                  storyId: p.chapter.storyId,
                  storyTitle: p.chapter.story.title,
                  chapterTitle: p.chapter.title,
                  createdAt: p.createdAt,
                },
              }),
            ]),
        ...(platformExists
          ? []
          : [
              prismaWithPlatform.platformEarning.create({
                data: {
                  type: "purchase",
                  grossAmount: split.gross,
                  authorAmount: split.author,
                  platformAmount: split.platform,
                  taxAmount: split.tax,
                  authorId: p.chapter.story.authorId,
                  fromUserId: p.userId,
                  chapterId: p.chapterId,
                  storyId: p.chapter.storyId,
                  storyTitle: p.chapter.story.title,
                  chapterTitle: p.chapter.title,
                  createdAt: p.createdAt,
                },
              }),
            ]),
      ]);

      migrated++;
    }

    res.json({ success: true, migrated, total: allPurchases.length });
  } catch (error) {
    console.error("Error migrating:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
