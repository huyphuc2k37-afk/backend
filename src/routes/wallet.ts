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

    res.json({
      balance: user.coinBalance,
      deposits,
      purchases,
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

    res.json({ success: true, spent: chapter.price, newBalance: user.coinBalance - chapter.price });
  } catch (error) {
    console.error("Error purchasing chapter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
