import { Router, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";
import { invalidateCache } from "../lib/cache";

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

    const [approvedDepositAmount, platformAgg, questAgg, viewEarningsAgg, adminCreditAgg, totalViewsAgg, xuInCirculation, totalAuthorEarningsAgg] = await Promise.all([
      prisma.deposit.aggregate({
        where: { status: "approved" },
        _sum: { amount: true },
      }),
      prisma.platformEarning.aggregate({
        _sum: { grossAmount: true, authorAmount: true, platformAmount: true, taxAmount: true },
      }),
      // Total xu dispensed from daily quests
      prisma.dailyQuest.aggregate({
        _sum: { coinsEarned: true },
      }),
      // Total xu dispensed from view earnings (author earnings type "view")
      prisma.authorEarning.aggregate({
        where: { type: "view" },
        _sum: { amount: true },
      }),
      // Total xu admin manually credited to authors
      prisma.authorEarning.aggregate({
        where: { type: "admin" },
        _sum: { amount: true },
      }),
      // Total views across all stories
      prisma.story.aggregate({
        _sum: { views: true },
      }),
      // Total xu currently in all user wallets
      prisma.user.aggregate({
        _sum: { coinBalance: true },
      }),
      // Total author earnings (all types: purchase, tip, view, admin)
      prisma.authorEarning.aggregate({
        _sum: { amount: true },
      }),
    ]);

    const grossContentRevenue = platformAgg._sum.grossAmount || 0;
    const platformGrossWallet = (platformAgg._sum.platformAmount || 0) + (platformAgg._sum.taxAmount || 0);
    const platformNetIncome = platformAgg._sum.platformAmount || 0;
    const taxTotal = platformAgg._sum.taxAmount || 0;
    const authorNetPaid = platformAgg._sum.authorAmount || 0;

    res.json({
      totalUsers,
      totalStories,
      totalChapters,
      pendingDeposits,
      pendingWithdrawals,
      // Deposits (cash-in)
      approvedDepositsAmount: approvedDepositAmount._sum.amount || 0,
      totalRevenue: approvedDepositAmount._sum.amount || 0,
      // Content revenue split (gross spending)
      grossContentRevenue,
      platformGrossWallet,
      platformNetIncome,
      taxTotal,
      authorNetPaid,
      // Quest rewards
      totalQuestXu: questAgg._sum.coinsEarned || 0,
      // View-based earnings
      totalViewEarningsXu: viewEarningsAgg._sum.amount || 0,
      // Admin manual credits
      totalAdminCreditXu: adminCreditAgg._sum.amount || 0,
      // Total author earnings (all types combined)
      totalAuthorEarnings: totalAuthorEarningsAgg._sum.amount || 0,
      // Total xu currently in user wallets
      totalXuInCirculation: xuInCirculation._sum.coinBalance || 0,
      // Total views
      totalViews: totalViewsAgg._sum.views || 0,
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
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
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
          isSuperMod: true, coinBalance: true, createdAt: true,
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
    const { role, isSuperMod } = req.body;
    const data: any = {};

    if (role !== undefined) {
      if (!["reader", "author", "moderator", "admin"].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      const admin = (req as any).adminUser;
      if (req.params.id === admin.id && role !== "admin") {
        return res.status(400).json({ error: "Không thể thay đổi role của chính mình" });
      }
      data.role = role;
      // Clear supermod flag when role changes away from moderator
      if (role !== "moderator") data.isSuperMod = false;
    }

    if (isSuperMod !== undefined) {
      data.isSuperMod = isSuperMod === true;
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, image: true, role: true, isSuperMod: true, coinBalance: true, createdAt: true },
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

    const targetId = req.params.id;

    // Atomic check + update inside transaction to prevent race condition
    let updated: { id: string; coinBalance: number };
    try {
      updated = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, coinBalance: true } });
        if (!user) throw new Error("USER_NOT_FOUND");

        if (coins < 0 && user.coinBalance + coins < 0) {
          throw new Error(`NEGATIVE_BALANCE:${user.coinBalance}`);
        }

        return tx.user.update({
          where: { id: user.id },
          data: { coinBalance: { increment: coins } },
          select: { id: true, coinBalance: true },
        });
      });
    } catch (txError: any) {
      if (txError.message === "USER_NOT_FOUND") {
        return res.status(404).json({ error: "User not found" });
      }
      if (txError.message?.startsWith("NEGATIVE_BALANCE:")) {
        const currentBalance = txError.message.split(":")[1];
        return res.status(400).json({
          error: `Không thể trừ ${Math.abs(coins)} xu. Số dư hiện tại: ${currentBalance} xu`,
        });
      }
      throw txError;
    }

    // Record admin credit as AuthorEarning for audit trail
    if (coins > 0) {
      await prisma.authorEarning.create({
        data: {
          type: "admin",
          amount: coins,
          authorId: updated.id,
          storyTitle: "Admin cộng xu",
          chapterTitle: reason || "Không có lý do",
        },
      }).catch(() => {});
    }

    // Gửi thông báo cho user
    const action = coins > 0 ? "cộng" : "trừ";
    await createNotificationSafe({
      data: {
        userId: updated.id,
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
    // Story & Announcement không có onDelete:Cascade nên phải xóa thủ công
    for (const userId of ids) {
      await prisma.$transaction(async (tx) => {
        // Lấy danh sách story IDs của user này
        const userStories = await tx.story.findMany({
          where: { authorId: userId },
          select: { id: true },
        });
        const storyIds = userStories.map((s: { id: string }) => s.id);

        if (storyIds.length > 0) {
          // Lấy chapter IDs
          const chapters = await tx.chapter.findMany({
            where: { storyId: { in: storyIds } },
            select: { id: true },
          });
          const chapterIds = chapters.map((c: { id: string }) => c.id);

          if (chapterIds.length > 0) {
            // Xóa dữ liệu liên quan chapters
            await tx.chapterPurchase.deleteMany({ where: { chapterId: { in: chapterIds } } });
            await tx.comment.deleteMany({ where: { chapterId: { in: chapterIds } } });
            await tx.readHistory.deleteMany({ where: { chapterId: { in: chapterIds } } });
            await tx.chapter.deleteMany({ where: { id: { in: chapterIds } } });
          }

          // Xóa dữ liệu liên quan stories
          await tx.storyTag.deleteMany({ where: { storyId: { in: storyIds } } });
          await tx.bookmark.deleteMany({ where: { storyId: { in: storyIds } } });
          await tx.storyLike.deleteMany({ where: { storyId: { in: storyIds } } });
          await tx.rating.deleteMany({ where: { storyId: { in: storyIds } } });
          await tx.comment.deleteMany({ where: { storyId: { in: storyIds } } });
          await tx.authorEarning.deleteMany({ where: { storyId: { in: storyIds } } });
          await tx.story.deleteMany({ where: { id: { in: storyIds } } });
        }

        // Xóa announcements do user tạo
        await tx.announcement.deleteMany({ where: { createdBy: userId } });

        // Xóa user
        await tx.user.delete({ where: { id: userId } });
      });
    }

    res.json({ success: true, deleted: ids.length });
  } catch (error) {
    console.error("Error deleting users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/stories — danh sách truyện ──
router.get("/stories", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
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
          featuredSlot: true,
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

// ─── PUT /api/admin/stories/:id/featured-slot — ghim truyện đầu trang ──
router.put("/stories/:id/featured-slot", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const rawSlot = req.body?.featuredSlot;
    const featuredSlot = rawSlot === null || rawSlot === undefined || rawSlot === ""
      ? null
      : Number(rawSlot);

    if (featuredSlot !== null && (!Number.isInteger(featuredSlot) || featuredSlot < 1 || featuredSlot > 5)) {
      return res.status(400).json({ error: "featuredSlot phải là số từ 1 đến 5 hoặc null" });
    }

    const storyId = req.params.id;
    const targetStory = await prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, title: true, featuredSlot: true },
    });

    if (!targetStory) {
      return res.status(404).json({ error: "Story not found" });
    }

    const updatedStory = await prisma.$transaction(async (tx) => {
      if (featuredSlot !== null) {
        await tx.story.updateMany({
          where: {
            featuredSlot,
            NOT: { id: storyId },
          },
          data: { featuredSlot: null },
        });
      }

      return tx.story.update({
        where: { id: storyId },
        data: { featuredSlot },
        select: {
          id: true,
          title: true,
          featuredSlot: true,
        },
      });
    });

    invalidateCache("stories:*");

    return res.json({
      success: true,
      story: updatedStory,
      message: featuredSlot === null
        ? `Đã gỡ truyện \"${targetStory.title}\" khỏi khu nổi bật`
        : `Đã ghim truyện \"${targetStory.title}\" vào vị trí ${featuredSlot}`,
    });
  } catch (error) {
    console.error("Error updating featured slot:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/admin/stories/:id — xóa truyện ──
router.delete("/stories/:id", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    // Warn if story has purchases
    const purchaseCount = await prisma.chapterPurchase.count({
      where: { chapter: { storyId: req.params.id } },
    });
    if (purchaseCount > 0 && req.query.force !== "true") {
      return res.status(400).json({
        error: `Truyện có ${purchaseCount} lượt mua chương. Thêm ?force=true để xác nhận xóa.`,
        purchaseCount,
      });
    }
    await prisma.story.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/admin/stories/:id/boost-views — cộng thêm views cho truyện ──
router.put("/stories/:id/boost-views", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const storyId = req.params.id;
    const amount = parseInt(req.body?.amount);

    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
      return res.status(400).json({ error: "Số lượt xem phải từ 1 đến 1,000,000" });
    }

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, title: true, views: true, lastSettledViews: true },
    });

    if (!story) {
      return res.status(404).json({ error: "Không tìm thấy truyện" });
    }

    // Increment views AND lastSettledViews so boosted views don't generate author earnings
    const updated = await prisma.story.update({
      where: { id: storyId },
      data: {
        views: { increment: amount },
        lastSettledViews: { increment: amount },
      },
      select: { id: true, title: true, views: true },
    });

    invalidateCache("stories:*");
    invalidateCache("ranking:*");

    return res.json({
      success: true,
      story: updated,
      message: `Đã cộng ${amount.toLocaleString()} lượt xem cho "${story.title}" (tổng: ${updated.views.toLocaleString()})`,
    });
  } catch (error) {
    console.error("Error boosting views:", error);
    return res.status(500).json({ error: "Internal server error" });
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
    // Warn if chapter has purchases
    const purchaseCount = await prisma.chapterPurchase.count({
      where: { chapterId: req.params.id },
    });
    if (purchaseCount > 0 && req.query.force !== "true") {
      return res.status(400).json({
        error: `Chương có ${purchaseCount} lượt mua. Thêm ?force=true để xác nhận xóa.`,
        purchaseCount,
      });
    }
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
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
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
      // Duyệt → cộng xu cho user (interactive transaction to prevent double-approval)
      await prisma.$transaction(async (tx) => {
        const freshDeposit = await tx.deposit.findUnique({ where: { id: deposit.id }, select: { status: true } });
        if (!freshDeposit || freshDeposit.status !== "pending") {
          throw new Error("ALREADY_PROCESSED");
        }
        await tx.deposit.update({
          where: { id: deposit.id },
          data: { status: "approved", adminNote },
        });
        await tx.user.update({
          where: { id: deposit.userId },
          data: { coinBalance: { increment: deposit.coins } },
        });
      });

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

      // ── Hoa hồng referral 2% trên nạp xu ──
      // Wrap in try-catch to avoid breaking the deposit approval response
      try {
        const depositUser = await prisma.user.findUnique({
          where: { id: deposit.userId },
          select: { referredById: true, name: true },
        });
        if (depositUser?.referredById) {
          const referrer = await prisma.user.findUnique({
            where: { id: depositUser.referredById },
            select: { id: true, role: true },
          });
          if (referrer && (referrer.role === "author" || referrer.role === "admin")) {
            const commission = Math.floor(deposit.coins * 0.02);
            if (commission >= 1) {
              await prisma.$transaction([
                prisma.user.update({
                  where: { id: referrer.id },
                  data: { coinBalance: { increment: commission } },
                }),
                prisma.referralEarning.create({
                  data: {
                    type: "deposit_commission",
                    amount: commission,
                    sourceAmount: deposit.coins,
                    rate: 0.02,
                    referrerId: referrer.id,
                    fromUserId: deposit.userId,
                    depositId: deposit.id,
                  },
                }),
              ]);

              await createNotificationSafe({
                data: {
                  userId: referrer.id,
                  type: "wallet",
                  title: "Hoa hồng giới thiệu — nạp xu",
                  message: `Người bạn giới thiệu vừa nạp ${deposit.coins.toLocaleString("vi-VN")} xu. Bạn nhận được ${commission.toLocaleString("vi-VN")} xu hoa hồng (2%).`,
                  link: "/profile",
                },
              });
            }
          }
        }
      } catch (refErr) {
        console.error("[Referral] deposit commission error (non-blocking):", refErr);
      }
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
  } catch (error: any) {
    if (error?.message === "ALREADY_PROCESSED") {
      return res.status(409).json({ error: "Yêu cầu nạp xu đã được xử lý trước đó" });
    }
    console.error("Error updating deposit:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/withdrawals — danh sách rút tiền ──
router.get("/withdrawals", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
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
      // Duyệt — xu đã bị trừ khi gửi yêu cầu, chỉ cần cập nhật status (with race guard)
      await prisma.$transaction(async (tx) => {
        const freshW = await tx.withdrawal.findUnique({ where: { id: withdrawal.id }, select: { status: true } });
        if (!freshW || freshW.status !== "pending") {
          throw new Error("ALREADY_PROCESSED");
        }
        await tx.withdrawal.update({
          where: { id: withdrawal.id },
          data: { status: "approved", adminNote },
        });
      });

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
      // Từ chối → hoàn xu cho tác giả (with race guard)
      await prisma.$transaction(async (tx) => {
        const freshW = await tx.withdrawal.findUnique({ where: { id: withdrawal.id }, select: { status: true } });
        if (!freshW || freshW.status !== "pending") {
          throw new Error("ALREADY_PROCESSED");
        }
        await tx.withdrawal.update({
          where: { id: withdrawal.id },
          data: { status: "rejected", adminNote },
        });
        await tx.user.update({
          where: { id: withdrawal.userId },
          data: { coinBalance: { increment: withdrawal.amount } },
        });
      });

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
  } catch (error: any) {
    if (error?.message === "ALREADY_PROCESSED") {
      return res.status(409).json({ error: "Yêu cầu rút tiền đã được xử lý trước đó" });
    }
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

    const users = await prisma.user.findMany({ select: { id: true }, take: 50000 });
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

// ─── POST /api/admin/notifications/send — gửi thông báo cá nhân ──
router.post("/notifications/send", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.body?.userId as string | undefined)?.trim();
    const title = (req.body?.title as string | undefined)?.trim();
    const message = (req.body?.message as string | undefined)?.trim();
    const link = (req.body?.link as string | undefined)?.trim() || null;

    if (!userId || !title || !message) {
      return res.status(400).json({ error: "userId, title and message are required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!user) return res.status(404).json({ error: "Người dùng không tồn tại" });

    const notification = await prisma.notification.create({
      data: { userId, type: "admin", title, message, link },
    });

    res.json({ success: true, notification, userName: user.name });
  } catch (error) {
    console.error("Error sending notification:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/users/search — tìm kiếm nhanh user cho autocomplete ──
router.get("/users/search", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const q = (req.query.q as string) || "";
    if (q.length < 1) return res.json([]);

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true, role: true, image: true },
      take: 10,
      orderBy: { name: "asc" },
    });

    res.json(users);
  } catch (error) {
    console.error("Error searching users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/banned-ips — danh sách IP bị chặn ──
router.get("/banned-ips", authRequired, adminRequired, async (_req: AuthRequest, res: Response) => {
  try {
    const ips = await prisma.bannedIP.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ ips });
  } catch (error) {
    console.error("Error fetching banned IPs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/admin/banned-ips — ban IP ──
router.post("/banned-ips", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { ip, reason } = req.body;
    if (!ip || typeof ip !== "string") {
      return res.status(400).json({ error: "IP không hợp lệ" });
    }
    const trimmedIP = ip.trim();
    const admin = (req as any).adminUser;

    const existing = await prisma.bannedIP.findUnique({ where: { ip: trimmedIP } });
    if (existing) {
      return res.status(400).json({ error: "IP này đã bị chặn trước đó" });
    }

    const banned = await prisma.bannedIP.create({
      data: {
        ip: trimmedIP,
        reason: reason || "Spam",
        bannedBy: admin.email,
      },
    });
    res.json({ success: true, banned });
  } catch (error) {
    console.error("Error banning IP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/admin/banned-ips/:id — unban IP ──
router.delete("/banned-ips/:id", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.bannedIP.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error("Error unbanning IP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/banned-emails — danh sách email bị chặn ──
router.get("/banned-emails", authRequired, adminRequired, async (_req: AuthRequest, res: Response) => {
  try {
    const emails = await prisma.bannedEmail.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ emails });
  } catch (error) {
    console.error("Error fetching banned emails:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/admin/banned-emails — ban email ──
router.post("/banned-emails", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { email: rawEmail, reason } = req.body;
    if (!rawEmail || typeof rawEmail !== "string") {
      return res.status(400).json({ error: "Email không hợp lệ" });
    }
    // Normalize to catch Gmail dot-trick variants
    const [local, domain] = rawEmail.toLowerCase().trim().split("@");
    let normalizedEmail = rawEmail.toLowerCase().trim();
    if (domain === "gmail.com" || domain === "googlemail.com") {
      const cleaned = local.replace(/\./g, "").replace(/\+.*$/, "");
      normalizedEmail = `${cleaned}@gmail.com`;
    }
    const admin = (req as any).adminUser;

    const existing = await prisma.bannedEmail.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(400).json({ error: "Email này đã bị chặn trước đó" });
    }

    const banned = await prisma.bannedEmail.create({
      data: {
        email: normalizedEmail,
        reason: reason || "Spam",
        bannedBy: admin.email,
      },
    });
    res.json({ success: true, banned });
  } catch (error) {
    console.error("Error banning email:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/admin/banned-emails/:id — unban email ──
router.delete("/banned-emails/:id", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.bannedEmail.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error("Error unbanning email:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
