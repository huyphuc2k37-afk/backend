import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ─── GET /api/admin/coin-credits ───────────────────────────────────
router.get("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user || (user.role !== "admin" && user.role !== "moderator")) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const adminId = req.query.adminId as string | undefined;
    const authorId = req.query.authorId as string | undefined;
    const search = req.query.search as string | undefined;

    const where: Record<string, unknown> = {};
    if (adminId) where.adminId = adminId;
    if (authorId) where.authorId = authorId;
    if (search) {
      where.OR = [
        { reason: { contains: search, mode: "insensitive" } },
      ];
    }

    const [credits, total] = await Promise.all([
      prisma.adminCoinCredit.findMany({
        where,
        include: {
          admin: { select: { id: true, name: true, email: true, image: true } },
          author: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.adminCoinCredit.count({ where }),
    ]);

    const totalAmount = await prisma.adminCoinCredit.aggregate({
      where,
      _sum: { amount: true },
    });

    res.json({
      credits,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      totalAmount: totalAmount._sum.amount || 0,
    });
  } catch (error) {
    console.error("Error fetching coin credits:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/coin-credits/stats ────────────────────────────
router.get("/stats", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user || (user.role !== "admin" && user.role !== "moderator")) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const period = (req.query.period as string) || "30d";
    let startDate: Date;
    switch (period) {
      case "7d": startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); break;
      case "30d": startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); break;
      case "90d": startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); break;
      case "365d": startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); break;
      default: startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    const [totalCredits, byAdmin, byAuthor] = await Promise.all([
      prisma.adminCoinCredit.aggregate({
        where: { createdAt: { gte: startDate } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.adminCoinCredit.groupBy({
        by: ["adminId"],
        where: { createdAt: { gte: startDate } },
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: "desc" } },
        take: 10,
      }),
      prisma.adminCoinCredit.groupBy({
        by: ["authorId"],
        where: { createdAt: { gte: startDate } },
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: "desc" } },
        take: 10,
      }),
    ]);

    const adminIds = byAdmin.map((b) => b.adminId);
    const authorIds = byAuthor.map((b) => b.authorId);

    const [admins, authors] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: adminIds } },
        select: { id: true, name: true, email: true, image: true },
      }),
      prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true, email: true, image: true },
      }),
    ]);

    const adminMap = Object.fromEntries(admins.map((a) => [a.id, a]));
    const authorMap = Object.fromEntries(authors.map((a) => [a.id, a]));

    res.json({
      period,
      totalAmount: totalCredits._sum.amount || 0,
      totalCount: totalCredits._count || 0,
      byAdmin: byAdmin.map((b) => ({
        admin: adminMap[b.adminId] || { id: b.adminId, name: "Unknown", email: "", image: null },
        amount: b._sum.amount || 0,
        count: b._count,
      })),
      byAuthor: byAuthor.map((b) => ({
        author: authorMap[b.authorId] || { id: b.authorId, name: "Unknown", email: "", image: null },
        amount: b._sum.amount || 0,
        count: b._count,
      })),
    });
  } catch (error) {
    console.error("Error fetching coin credit stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/admin/coin-credits ─────────────────────────────────
router.post("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { authorId, amount, reason } = req.body;

    if (!authorId || !amount || !reason) {
      return res.status(400).json({ error: "authorId, amount, and reason are required" });
    }

    const coins = typeof amount === "string" ? parseInt(amount, 10) : amount;
    if (!Number.isFinite(coins) || !Number.isInteger(coins) || coins === 0) {
      return res.status(400).json({ error: "Số xu phải là số nguyên khác 0" });
    }

    let updated: { id: string; coinBalance: number };
    let createdCredit;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: authorId },
          select: { id: true, coinBalance: true },
        });
        if (!target) throw new Error("USER_NOT_FOUND");
        if (coins < 0 && target.coinBalance + coins < 0) {
          throw new Error("NEGATIVE_BALANCE");
        }

        const updatedUser = await tx.user.update({
          where: { id: target.id },
          data: { coinBalance: { increment: coins } },
          select: { id: true, coinBalance: true },
        });

        const credit = await tx.adminCoinCredit.create({
          data: {
            adminId: user.id,
            authorId,
            amount: coins,
            reason,
          },
        });

        if (coins > 0) {
          await tx.authorEarning.create({
            data: {
              type: "admin",
              amount: coins,
              authorId,
              storyTitle: "Admin cộng xu",
              chapterTitle: reason,
            },
          });
        }

        return { updatedUser, credit };
      });

      updated = result.updatedUser;
      createdCredit = result.credit;
    } catch (txError: any) {
      if (txError.message === "USER_NOT_FOUND") {
        return res.status(404).json({ error: "User not found" });
      }
      if (txError.message === "NEGATIVE_BALANCE") {
        return res.status(400).json({ error: "Số dư không đủ" });
      }
      throw txError;
    }

    // Send notification
    try {
      await prisma.notification.create({
        data: {
          userId: authorId,
          type: "wallet",
          title: `Admin đã cộng ${Math.abs(coins).toLocaleString("vi-VN")} xu`,
          message: `Lý do: ${reason}. Số dư mới: ${updated.coinBalance.toLocaleString("vi-VN")} xu.`,
          link: "/wallet",
        },
      });
    } catch {}

    res.json({
      success: true,
      newBalance: updated.coinBalance,
      credit: createdCredit,
    });
  } catch (error) {
    console.error("Error creating coin credit:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
