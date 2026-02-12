import { Router, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ─── Admin middleware ────────────────────────────
async function adminRequired(req: AuthRequest, res: Response, next: NextFunction) {
  const user = await prisma.user.findUnique({
    where: { email: req.user!.email },
  });
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  (req as any).adminUser = user;
  next();
}

// ─── GET /api/admin/stats — tổng quan dashboard ──
router.get("/stats", authRequired, adminRequired, async (_req: AuthRequest, res: Response) => {
  try {
    const [totalUsers, totalStories, totalChapters, pendingDeposits, pendingWithdrawals] =
      await Promise.all([
        prisma.user.count(),
        prisma.story.count(),
        prisma.chapter.count(),
        prisma.deposit.count({ where: { status: "pending" } }),
        prisma.withdrawal.count({ where: { status: "pending" } }),
      ]);

    const totalRevenue = await prisma.deposit.aggregate({
      where: { status: "approved" },
      _sum: { amount: true },
    });

    res.json({
      totalUsers,
      totalStories,
      totalChapters,
      pendingDeposits,
      pendingWithdrawals,
      totalRevenue: totalRevenue._sum.amount || 0,
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/users — danh sách người dùng ──
router.get("/users", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || "";
    const role = req.query.role as string;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }
    if (role) where.role = role;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, image: true, role: true,
          coinBalance: true, createdAt: true,
          _count: { select: { stories: true, comments: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/admin/users/:id — cập nhật role user ──
router.put("/users/:id", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.body;
    if (!["reader", "author", "admin"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
    });
    res.json(user);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/stories — danh sách truyện ──
router.get("/stories", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || "";

    const where: any = {};
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { author: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [stories, total] = await Promise.all([
      prisma.story.findMany({
        where,
        include: {
          author: { select: { id: true, name: true, email: true } },
          _count: { select: { chapters: true, bookmarks: true, comments: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.story.count({ where }),
    ]);

    res.json({ stories, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("Error fetching stories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/admin/stories/:id — xóa truyện ──
router.delete("/stories/:id", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.story.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/deposits — danh sách nạp xu ──
router.get("/deposits", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;

    const where: any = {};
    if (status) where.status = status;

    const [deposits, total] = await Promise.all([
      prisma.deposit.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.deposit.count({ where }),
    ]);

    res.json({ deposits, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("Error fetching deposits:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/admin/deposits/:id — duyệt/từ chối nạp xu ──
router.put("/deposits/:id", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { status, adminNote } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Status must be approved or rejected" });
    }

    const deposit = await prisma.deposit.findUnique({
      where: { id: req.params.id },
    });
    if (!deposit) return res.status(404).json({ error: "Deposit not found" });
    if (deposit.status !== "pending") {
      return res.status(400).json({ error: "Deposit already processed" });
    }

    if (status === "approved") {
      // Duyệt → cộng xu cho user
      await prisma.$transaction([
        prisma.deposit.update({
          where: { id: deposit.id },
          data: { status: "approved", adminNote },
        }),
        prisma.user.update({
          where: { id: deposit.userId },
          data: { coinBalance: { increment: deposit.coins } },
        }),
      ]);
    } else {
      // Từ chối
      await prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: "rejected", adminNote },
      });
    }

    const updated = await prisma.deposit.findUnique({
      where: { id: deposit.id },
      include: { user: { select: { id: true, name: true, email: true, coinBalance: true } } },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating deposit:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/withdrawals — danh sách rút tiền ──
router.get("/withdrawals", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;

    const where: any = {};
    if (status) where.status = status;

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawal.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.withdrawal.count({ where }),
    ]);

    res.json({ withdrawals, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("Error fetching withdrawals:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/admin/withdrawals/:id — duyệt/từ chối rút tiền ──
router.put("/withdrawals/:id", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { status, adminNote } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Status must be approved or rejected" });
    }

    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: req.params.id },
    });
    if (!withdrawal) return res.status(404).json({ error: "Withdrawal not found" });
    if (withdrawal.status !== "pending") {
      return res.status(400).json({ error: "Withdrawal already processed" });
    }

    if (status === "approved") {
      // Duyệt — xu đã bị trừ khi gửi yêu cầu, chỉ cần cập nhật status
      await prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: "approved", adminNote },
      });
    } else {
      // Từ chối → hoàn xu cho tác giả
      await prisma.$transaction([
        prisma.withdrawal.update({
          where: { id: withdrawal.id },
          data: { status: "rejected", adminNote },
        }),
        prisma.user.update({
          where: { id: withdrawal.userId },
          data: { coinBalance: { increment: withdrawal.amount } },
        }),
      ]);
    }

    const updated = await prisma.withdrawal.findUnique({
      where: { id: withdrawal.id },
      include: { user: { select: { id: true, name: true, email: true, coinBalance: true } } },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating withdrawal:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
