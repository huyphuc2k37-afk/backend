import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ─── GET /api/wallet — lấy thông tin ví ──────────
router.get("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true, coinBalance: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Lịch sử nạp xu
    const deposits = await prisma.deposit.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Lịch sử mua chương
    const purchases = await prisma.chapterPurchase.findMany({
      where: { userId: user.id },
      include: {
        chapter: {
          select: {
            title: true,
            number: true,
            story: { select: { title: true, slug: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // IDs of purchased chapters (for quick lookup)
    const purchasedChapterIds = purchases.map((p) => p.chapterId);

    res.json({
      userId: user.id,
      coinBalance: user.coinBalance,
      balance: user.coinBalance,
      deposits,
      purchases,
      purchasedChapterIds,
    });
  } catch (error) {
    console.error("Error fetching wallet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/wallet/deposit — tạo yêu cầu nạp xu ──
router.post("/deposit", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const { amount, coins, method, transferNote } = req.body;

    if (!amount || !coins || !method) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const deposit = await prisma.deposit.create({
      data: {
        amount,
        coins,
        method,
        transferNote: transferNote || null,
        userId: user.id,
      },
    });

    res.json(deposit);
  } catch (error) {
    console.error("Error creating deposit:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/wallet/purchase — mua chương truyện ──
router.post("/purchase", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const { chapterId } = req.body;
    if (!chapterId) return res.status(400).json({ error: "chapterId is required" });

    // Kiểm tra chương có tồn tại và có khóa không
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: { select: { authorId: true } } },
    });
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    if (!chapter.isLocked) return res.status(400).json({ error: "Chapter is free" });

    // Kiểm tra đã mua chưa
    const existing = await prisma.chapterPurchase.findUnique({
      where: { userId_chapterId: { userId: user.id, chapterId } },
    });
    if (existing) return res.status(400).json({ error: "Already purchased" });

    // Kiểm tra số dư
    if (user.coinBalance < chapter.price) {
      return res.status(400).json({ error: "Insufficient balance", required: chapter.price, balance: user.coinBalance });
    }

    // Trừ xu reader + cộng xu tác giả (70/30 split — tác giả nhận 70%)
    const authorShare = Math.floor(chapter.price * 0.7);

    await prisma.$transaction([
      // Trừ xu người mua
      prisma.user.update({
        where: { id: user.id },
        data: { coinBalance: { decrement: chapter.price } },
      }),
      // Cộng xu cho tác giả
      prisma.user.update({
        where: { id: chapter.story.authorId },
        data: { coinBalance: { increment: authorShare } },
      }),
      // Ghi nhận giao dịch mua
      prisma.chapterPurchase.create({
        data: {
          userId: user.id,
          chapterId,
          coins: chapter.price,
        },
      }),
    ]);

    // Thông báo cho tác giả (fire-and-forget)
    prisma.notification.create({
      data: {
        userId: chapter.story.authorId,
        title: "Có người mua chương truyện",
        message: `Ai đó đã mua chương "${chapter.title}" với giá ${chapter.price} xu. Bạn nhận được ${authorShare} xu.`,
        type: "wallet",
      },
    }).catch(() => {});

    res.json({ success: true, spent: chapter.price, newBalance: user.coinBalance - chapter.price });
  } catch (error) {
    console.error("Error purchasing chapter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/wallet/tip — tặng xu cho tác giả theo chương ──
router.post("/tip", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const { chapterId, coins } = req.body;
    if (!chapterId) return res.status(400).json({ error: "chapterId is required" });

    const amount = typeof coins === "string" ? parseInt(coins, 10) : coins;
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 100) {
      return res.status(400).json({ error: "Số xu tặng tối thiểu là 100" });
    }
    if (amount > 50000) {
      return res.status(400).json({ error: "Số xu tặng tối đa là 50,000" });
    }

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: { select: { authorId: true, title: true } } },
    });
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    if (user.id === chapter.story.authorId) {
      return res.status(400).json({ error: "Không thể tặng xu cho chính mình" });
    }

    // Admin can gift unlimited xu (no balance check, no deduction)
    const isAdmin = user.role === "admin";

    if (!isAdmin && user.coinBalance < amount) {
      return res.status(400).json({ error: "Không đủ xu", required: amount, balance: user.coinBalance });
    }

    const txOps: any[] = [];
    if (!isAdmin) {
      txOps.push(
        prisma.user.update({
          where: { id: user.id },
          data: { coinBalance: { decrement: amount } },
          select: { coinBalance: true, id: true },
        })
      );
    }
    txOps.push(
      prisma.user.update({
        where: { id: chapter.story.authorId },
        data: { coinBalance: { increment: amount } },
        select: { id: true },
      })
    );

    const results = await prisma.$transaction(txOps);
    const newBalance = isAdmin ? user.coinBalance : results[0].coinBalance;

    // Thông báo cho tác giả
    const senderLabel = isAdmin ? "Admin VStory" : user.name;
    prisma.notification.create({
      data: {
        userId: chapter.story.authorId,
        title: isAdmin ? "🎁 Admin đã tặng xu!" : "Bạn nhận được xu ủng hộ",
        message: `${senderLabel} đã tặng ${amount.toLocaleString("vi-VN")} xu ủng hộ chương "${chapter.title}" trong truyện "${chapter.story.title}".`,
        type: "wallet",
        link: "/write/revenue",
      },
    }).catch(() => {});

    res.json({ success: true, spent: isAdmin ? 0 : amount, newBalance });
  } catch (error) {
    console.error("Error tipping chapter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
