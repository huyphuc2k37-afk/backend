import { Router, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

async function createNotificationSafe(args: Parameters<typeof prisma.notification.create>[0]) {
  try {
    await prisma.notification.create(args);
  } catch (error) {
    // Important: don't break critical flows (approve/reject) if notifications table isn't migrated yet.
    console.warn("Notification create failed (ignored):", error);
  }
}

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

// ─── PUT /api/admin/stats/revenue — điều chỉnh doanh thu (xóa/sửa deposit) ──
router.put("/stats/revenue", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { action, depositId } = req.body;

    if (action === "delete" && depositId) {
      // Xóa 1 deposit (không hoàn xu — chỉ xóa record)
      const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
      if (!deposit) return res.status(404).json({ error: "Deposit not found" });
      await prisma.deposit.delete({ where: { id: depositId } });
      return res.json({ success: true, message: `Đã xóa deposit ${deposit.amount.toLocaleString("vi-VN")}đ` });
    }

    if (action === "reset-all") {
      // Require explicit confirmation param to prevent accidental mass deletion
      if (req.body.confirm !== "CONFIRM_RESET_ALL") {
        return res.status(400).json({ error: "Vui lòng gửi confirm: 'CONFIRM_RESET_ALL' để xác nhận" });
      }
      // Xóa tất cả deposit đã duyệt (test data cleanup)
      const result = await prisma.deposit.deleteMany({ where: { status: "approved" } });
      return res.json({ success: true, message: `Đã xóa ${result.count} deposit đã duyệt` });
    }

    return res.status(400).json({ error: "Invalid action. Use 'delete' or 'reset-all'" });
  } catch (error) {
    console.error("Error adjusting revenue:", error);
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
    if (!["reader", "author", "moderator", "admin"].includes(role)) {
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

// ─── POST /api/admin/users/:id/adjust-coins — cộng/trừ xu tài khoản ──
router.post("/users/:id/adjust-coins", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { amount, reason } = req.body;
    const coins = typeof amount === "string" ? parseInt(amount, 10) : amount;
    if (!Number.isFinite(coins) || !Number.isInteger(coins) || coins === 0) {
      return res.status(400).json({ error: "Số xu phải là số nguyên khác 0" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Nếu trừ xu, kiểm tra không cho âm
    if (coins < 0 && user.coinBalance + coins < 0) {
      return res.status(400).json({
        error: `Không thể trừ ${Math.abs(coins)} xu. Số dư hiện tại: ${user.coinBalance} xu`,
      });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { coinBalance: { increment: coins } },
      select: { id: true, coinBalance: true },
    });

    // Gửi thông báo cho user
    const action = coins > 0 ? "cộng" : "trừ";
    await createNotificationSafe({
      data: {
        userId: user.id,
        type: "wallet",
        title: `Admin đã ${action} ${Math.abs(coins).toLocaleString("vi-VN")} xu`,
        message: reason
          ? `Lý do: ${reason}. Số dư mới: ${updated.coinBalance.toLocaleString("vi-VN")} xu.`
          : `Số dư mới: ${updated.coinBalance.toLocaleString("vi-VN")} xu.`,
        link: "/wallet",
      },
    });

    res.json({ success: true, newBalance: updated.coinBalance });
  } catch (error) {
    console.error("Error adjusting coins:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/admin/users — xóa người dùng (đơn lẻ hoặc hàng loạt) ──
router.delete("/users", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body; // array of user IDs
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Cần cung cấp danh sách ID người dùng" });
    }

    const admin = (req as any).adminUser;
    // Không cho xóa chính mình
    if (ids.includes(admin.id)) {
      return res.status(400).json({ error: "Không thể xóa tài khoản admin đang đăng nhập" });
    }

    // Xóa tất cả dữ liệu liên quan rồi xóa user
    const result = await prisma.user.deleteMany({
      where: { id: { in: ids }, role: { not: "admin" } },
    });

    res.json({ success: true, deleted: result.count });
  } catch (error) {
    console.error("Error deleting users:", error);
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
        select: {
          id: true,
          title: true,
          slug: true,
          genre: true,
          status: true,
          views: true,
          likes: true,
          isAdult: true,
          approvalStatus: true,
          createdAt: true,
          updatedAt: true,
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

// ─── GET /api/admin/stories/:id/chapters — danh sách chương của truyện ──
router.get("/stories/:id/chapters", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const chapters = await prisma.chapter.findMany({
      where: { storyId: req.params.id },
      select: { id: true, title: true, number: true, wordCount: true, isLocked: true, price: true, createdAt: true },
      orderBy: { number: "asc" },
    });
    res.json(chapters);
  } catch (error) {
    console.error("Error fetching chapters:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/admin/chapters/:id — xóa chương ──
router.delete("/chapters/:id", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.chapter.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting chapter:", error);
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

      await createNotificationSafe({
        data: {
          userId: deposit.userId,
          type: "wallet",
          title: "Nạp xu đã được duyệt",
          message:
            `Yêu cầu nạp ${deposit.coins} xu (tương ứng ${deposit.amount}đ) đã được duyệt.` +
            (adminNote ? `\nGhi chú: ${adminNote}` : ""),
          link: "/wallet",
        },
      });
    } else {
      // Từ chối
      await prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: "rejected", adminNote },
      });

      await createNotificationSafe({
        data: {
          userId: deposit.userId,
          type: "wallet",
          title: "Yêu cầu nạp xu bị từ chối",
          message:
            `Yêu cầu nạp ${deposit.coins} xu (tương ứng ${deposit.amount}đ) đã bị từ chối.` +
            (adminNote ? `\nLý do: ${adminNote}` : ""),
          link: "/wallet",
        },
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
      await prisma.$transaction([
        prisma.withdrawal.update({
          where: { id: withdrawal.id },
          data: { status: "approved", adminNote },
        }),
      ]);

      await createNotificationSafe({
        data: {
          userId: withdrawal.userId,
          type: "wallet",
          title: "Yêu cầu rút tiền đã được duyệt",
          message:
            `Yêu cầu rút ${withdrawal.amount} xu (tương ứng ${withdrawal.moneyAmount}đ) đã được duyệt.` +
            (adminNote ? `\nGhi chú: ${adminNote}` : ""),
          link: "/write/withdraw",
        },
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

      await createNotificationSafe({
        data: {
          userId: withdrawal.userId,
          type: "wallet",
          title: "Yêu cầu rút tiền bị từ chối",
          message:
            `Yêu cầu rút ${withdrawal.amount} xu (tương ứng ${withdrawal.moneyAmount}đ) đã bị từ chối.` +
            (adminNote ? `\nLý do: ${adminNote}` : ""),
          link: "/write/withdraw",
        },
      });
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

// ─── POST /api/admin/notifications/broadcast — gửi thông báo cho mọi người ──
router.post("/notifications/broadcast", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const title = (req.body?.title as string | undefined)?.trim();
    const message = (req.body?.message as string | undefined)?.trim();
    if (!title || !message) {
      return res.status(400).json({ error: "Title and message are required" });
    }

    const users = await prisma.user.findMany({ select: { id: true } });
    if (users.length === 0) return res.json({ success: true, count: 0 });

    const result = await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: "admin",
        title,
        message,
      })),
    });

    res.json({ success: true, count: result.count });
  } catch (error) {
    console.error("Error broadcasting notification:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
