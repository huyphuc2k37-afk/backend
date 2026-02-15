import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ── Helpers ──────────────────────────────────────
function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "REF";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createNotificationSafe(args: Parameters<typeof prisma.notification.create>[0]) {
  try {
    await prisma.notification.create(args);
  } catch (error) {
    console.warn("Notification create failed (ignored):", error);
  }
}

// GET /api/profile — get current user profile
router.get("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    let user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      include: {
        stories: {
          select: { id: true, title: true, slug: true, views: true, likes: true, status: true, approvalStatus: true, createdAt: true },
          orderBy: { updatedAt: "desc" },
        },
        _count: { select: { stories: true, bookmarks: true, comments: true } },
      },
    });

    // Auto-create user if first login
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: req.user!.email,
          name: req.user!.name || "Người dùng",
          image: req.user!.image,
        },
        include: {
          stories: {
            select: { id: true, title: true, slug: true, views: true, likes: true, status: true, approvalStatus: true, createdAt: true },
            orderBy: { updatedAt: "desc" },
          },
          _count: { select: { stories: true, bookmarks: true, comments: true } },
        },
      });
    }

    // Include referral info
    const referralData: any = {
      referralCode: user.referralCode || null,
      referredById: user.referredById || null,
    };

    // Auto-generate referral code for existing authors who don't have one
    if ((user.role === "author" || user.role === "admin") && !user.referralCode) {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      for (let attempt = 0; attempt < 10; attempt++) {
        let code = "REF";
        for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
        const exists = await prisma.user.findUnique({ where: { referralCode: code } });
        if (!exists) {
          await prisma.user.update({ where: { id: user.id }, data: { referralCode: code } });
          referralData.referralCode = code;
          break;
        }
      }
    }

    // If user was referred, get referrer name
    if (user.referredById) {
      const referrer = await prisma.user.findUnique({
        where: { id: user.referredById },
        select: { name: true },
      });
      referralData.referredByName = referrer?.name || null;
    }

    // Count referrals made by this user
    if (user.role === "author" || user.role === "admin") {
      referralData.referralCount = await prisma.user.count({
        where: { referredById: user.id },
      });
    }

    res.json({ ...user, ...referralData });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/profile — update profile
router.put("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { name, bio, role, image } = req.body;

    const existing = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true, role: true, referralCode: true },
    });
    if (!existing) return res.status(404).json({ error: "User not found" });

    const data: any = {};
    if (name) data.name = name;
    if (bio !== undefined) data.bio = bio;
    if (image !== undefined) data.image = image;
    if (role === "author") {
      if (existing.role === "admin" || existing.role === "moderator") {
        return res.status(400).json({ error: "Không thể thay đổi vai trò hiện tại" });
      }
      if (existing.role === "author") {
        return res.status(400).json({ error: "Already an author" });
      }
      data.role = "author"; // allow upgrade to author only (from reader)

      // Auto-generate referral code when becoming author
      if (!existing.referralCode) {
        let referralCode = "";
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = generateReferralCode();
          const exists = await prisma.user.findUnique({ where: { referralCode: candidate } });
          if (!exists) { referralCode = candidate; break; }
        }
        if (referralCode) data.referralCode = referralCode;
      }

      // If this user was referred by another author, notify the referrer
      // about their referral becoming an author (they now earn 1% commission)
      const userFull = await prisma.user.findUnique({
        where: { id: existing.id },
        select: { referredById: true, name: true },
      });
      if (userFull?.referredById) {
        await createNotificationSafe({
          data: {
            userId: userFull.referredById,
            type: "wallet",
            title: "Người bạn giới thiệu đã trở thành tác giả!",
            message: `${userFull.name} mà bạn giới thiệu đã đăng ký thành tác giả. Bạn sẽ nhận 1% hoa hồng từ thu nhập thực tế của họ.`,
            link: "/profile",
          },
        });
      }
    }

    const user = await prisma.user.update({
      where: { email: req.user!.email },
      data,
    });

    res.json(user);
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/profile/referral — nhập mã mời
router.post("/referral", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { referralCode } = req.body;
    if (!referralCode || typeof referralCode !== "string") {
      return res.status(400).json({ error: "Vui lòng nhập mã mời" });
    }

    const code = referralCode.trim().toUpperCase();

    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true, referredById: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Đã nhập mã rồi — không cho đổi
    if (user.referredById) {
      return res.status(400).json({ error: "Bạn đã nhập mã mời trước đó rồi, không thể thay đổi" });
    }

    // Tìm tác giả sở hữu mã mời
    const referrer = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true, name: true, role: true },
    });
    if (!referrer) {
      return res.status(404).json({ error: "Mã mời không hợp lệ" });
    }
    if (referrer.role !== "author" && referrer.role !== "admin") {
      return res.status(400).json({ error: "Mã mời không hợp lệ" });
    }

    // Không cho tự giới thiệu
    if (referrer.id === user.id) {
      return res.status(400).json({ error: "Bạn không thể nhập mã mời của chính mình" });
    }

    // Lưu referrer
    await prisma.user.update({
      where: { id: user.id },
      data: { referredById: referrer.id },
    });

    // Thông báo cho tác giả giới thiệu
    await createNotificationSafe({
      data: {
        userId: referrer.id,
        type: "wallet",
        title: "Có người dùng mã mời của bạn!",
        message: `Một người dùng đã nhập mã mời của bạn. Bạn sẽ nhận 2% hoa hồng từ mỗi giao dịch nạp xu của họ.`,
        link: "/profile",
      },
    });

    res.json({ success: true, referrerName: referrer.name });
  } catch (error) {
    console.error("Error applying referral code:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/profile/referral-stats — thống kê hoa hồng giới thiệu (chỉ tác giả)
router.get("/referral-stats", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true, role: true, referralCode: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role !== "author" && user.role !== "admin") {
      return res.status(403).json({ error: "Chỉ tác giả mới xem được" });
    }

    // Những user mình đã giới thiệu
    const referredUsers = await prisma.user.findMany({
      where: { referredById: user.id },
      select: { id: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    // Tổng hoa hồng
    const totalEarnings = await prisma.referralEarning.aggregate({
      where: { referrerId: user.id },
      _sum: { amount: true },
    });

    // Hoa hồng theo loại
    const depositCommission = await prisma.referralEarning.aggregate({
      where: { referrerId: user.id, type: "deposit_commission" },
      _sum: { amount: true },
      _count: true,
    });

    const authorCommission = await prisma.referralEarning.aggregate({
      where: { referrerId: user.id, type: "author_income_commission" },
      _sum: { amount: true },
      _count: true,
    });

    // Lịch sử gần đây
    const recentEarnings = await prisma.referralEarning.findMany({
      where: { referrerId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    res.json({
      referralCode: user.referralCode,
      referredUsers,
      totalEarnings: totalEarnings._sum.amount || 0,
      depositCommission: {
        total: depositCommission._sum.amount || 0,
        count: depositCommission._count || 0,
      },
      authorCommission: {
        total: authorCommission._sum.amount || 0,
        count: authorCommission._count || 0,
      },
      recentEarnings,
    });
  } catch (error) {
    console.error("Error fetching referral stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
