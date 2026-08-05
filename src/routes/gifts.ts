import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";
import { splitRevenue } from "../lib/revenueSplit";
import { invalidateCache } from "../lib/cache";

const router = Router();

// ─── GET /api/gifts/types — Get all active gift types ────────────────────────
router.get("/types", async (_req, res: Response) => {
  try {
    const gifts = await prisma.giftType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        emoji: true,
        price: true,
        animationUrl: true,
      },
    });
    res.json({ gifts });
  } catch (error) {
    console.error("Error fetching gift types:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/gifts/send — Send a gift to an author ─────────────────────────
router.post("/send", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const { receiverId, storyId, giftTypeId, quantity = 1, message } = req.body;

    if (!receiverId) return res.status(400).json({ error: "receiverId is required" });
    if (!giftTypeId) return res.status(400).json({ error: "giftTypeId is required" });

    const qty = typeof quantity === "string" ? parseInt(quantity, 10) : quantity;
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ error: "Số lượng phải lớn hơn 0" });
    }
    if (qty > 99) {
      return res.status(400).json({ error: "Số lượng tối đa là 99" });
    }

    // Fetch gift type
    const giftType = await prisma.giftType.findUnique({
      where: { id: giftTypeId },
    });
    if (!giftType || !giftType.isActive) {
      return res.status(404).json({ error: "Gift type not found or inactive" });
    }

    // Verify receiver exists and is an author
    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, role: true },
    });
    if (!receiver) return res.status(404).json({ error: "Receiver not found" });

    // Prevent self-gifting
    if (user.id === receiverId) {
      return res.status(400).json({ error: "Không thể tặng quà cho chính mình" });
    }

    const totalCoins = giftType.price * qty;

    // Check balance
    if (user.coinBalance < totalCoins) {
      return res.status(400).json({
        error: "Không đủ xu",
        required: totalCoins,
        balance: user.coinBalance,
      });
    }

    // Verify story exists if provided
    if (storyId) {
      const story = await prisma.story.findUnique({
        where: { id: storyId },
        select: { authorId: true, title: true },
      });
      if (!story) return res.status(404).json({ error: "Story not found" });
    }

    // Fetch receiver's referral status before transaction
    const receiverUser = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { referredById: true },
    });
    const referredById = receiverUser?.referredById ?? null;

    let newBalance = user.coinBalance;

    // Transaction: deduct coins, add to author, create transaction record
    await prisma.$transaction(async (tx) => {
      // Atomic conditional decrement
      const decremented = await tx.user.updateMany({
        where: { id: user.id, coinBalance: { gte: totalCoins } },
        data: { coinBalance: { decrement: totalCoins } },
      });
      if (decremented.count === 0) throw new Error("INSUFFICIENT_BALANCE");

      // Get updated balance
      const updatedUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { coinBalance: true },
      });
      newBalance = updatedUser?.coinBalance ?? (user.coinBalance - totalCoins);

      // Revenue split (65% author, 30% platform, 5% tax)
      const split = splitRevenue(totalCoins);
      const authorShare = split.author;

      // Add to author's balance
      await tx.user.update({
        where: { id: receiverId },
        data: { coinBalance: { increment: authorShare } },
      });

      // Create gift transaction
      const transaction = await tx.giftTransaction.create({
        data: {
          senderId: user.id,
          receiverId,
          storyId: storyId || null,
          giftTypeId,
          quantity: qty,
          totalCoins,
          message: message?.trim() || null,
        },
        include: {
          giftType: { select: { name: true, emoji: true } },
        },
      });

      // Record author earnings
      await tx.authorEarning.create({
        data: {
          type: "gift",
          amount: authorShare,
          authorId: receiverId,
          fromUserId: user.id,
          storyId: storyId || null,
          storyTitle: null,
          chapterId: null,
          chapterTitle: null,
        },
      });

      // Record platform earnings
      await tx.platformEarning.create({
        data: {
          type: "gift",
          grossAmount: split.gross,
          authorAmount: split.author,
          platformAmount: split.platform,
          taxAmount: split.tax,
          authorId: receiverId,
          fromUserId: user.id,
          storyId: storyId || null,
        },
      });

      // Referral commission for author (1% of author's share)
      if (referredById) {
        const referrer = await tx.user.findUnique({
          where: { id: referredById },
          select: { id: true, role: true },
        });
        if (referrer && (referrer.role === "author" || referrer.role === "admin")) {
          const commission = Math.floor(authorShare * 0.01);
          if (commission >= 1) {
            await tx.user.update({
              where: { id: referrer.id },
              data: { coinBalance: { increment: commission } },
            });
            await tx.referralEarning.create({
              data: {
                type: "author_income_commission",
                amount: commission,
                sourceAmount: authorShare,
                rate: 0.01,
                referrerId: referrer.id,
                fromUserId: receiverId,
                storyId: storyId || null,
                storyTitle: null,
                chapterId: null,
                chapterTitle: null,
              },
            });
          }
        }
      }

      return transaction;
    });

    // Notify author (fire-and-forget)
    prisma.notification.create({
      data: {
        userId: receiverId,
        title: "🎁 Bạn nhận được quà!",
        message: `${user.name} đã tặng bạn ${qty}x ${giftType.emoji} ${giftType.name}${message ? `: "${message}"` : ""}. Bạn nhận được ${splitRevenue(totalCoins).author.toLocaleString("vi-VN")} xu.`,
        type: "wallet",
        link: storyId ? `/story/${storyId}` : "/profile",
      },
    }).catch((err) => console.error("[Notification] gift notification error:", err));

    // Invalidate sender's wallet cache
    invalidateCache(
      `wallet:${user.email}`,
      `wallet:balance:${user.email}`,
      `wallet:history:${user.email}`
    );

    res.json({
      success: true,
      spent: totalCoins,
      newBalance,
      gift: {
        name: giftType.name,
        emoji: giftType.emoji,
        quantity: qty,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ error: "Không đủ xu" });
    }
    console.error("Error sending gift:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/gifts/sent — Get user's sent gifts ───────────────────────────────
router.get("/sent", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.giftTransaction.findMany({
        where: { senderId: user.id },
        include: {
          giftType: { select: { name: true, emoji: true } },
          receiver: { select: { id: true, name: true, image: true } },
          story: { select: { id: true, title: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.giftTransaction.count({ where: { senderId: user.id } }),
    ]);

    res.json({
      transactions,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching sent gifts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/gifts/received — Get author's received gifts ────────────────────
router.get("/received", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const skip = (page - 1) * limit;

    // Summary stats
    const stats = await prisma.giftTransaction.aggregate({
      where: { receiverId: user.id },
      _sum: { totalCoins: true },
      _count: true,
    });

    // Top gift types received
    const topGifts = await prisma.giftTransaction.groupBy({
      by: ["giftTypeId"],
      where: { receiverId: user.id },
      _sum: { quantity: true, totalCoins: true },
      _count: true,
      orderBy: { _count: { giftTypeId: "desc" } },
      take: 5,
    });

    const giftTypeIds = topGifts.map((g) => g.giftTypeId);
    const giftTypes = await prisma.giftType.findMany({
      where: { id: { in: giftTypeIds } },
      select: { id: true, name: true, emoji: true },
    });
    const giftTypeMap = Object.fromEntries(giftTypes.map((g) => [g.id, g]));

    const topGiftsWithDetails = topGifts.map((g) => ({
      giftTypeId: g.giftTypeId,
      quantity: g._sum.quantity || 0,
      totalCoins: g._sum.totalCoins || 0,
      giftType: giftTypeMap[g.giftTypeId] || null,
    }));

    // Recent transactions
    const [transactions, total] = await Promise.all([
      prisma.giftTransaction.findMany({
        where: { receiverId: user.id },
        include: {
          giftType: { select: { name: true, emoji: true } },
          sender: { select: { id: true, name: true, image: true } },
          story: { select: { id: true, title: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.giftTransaction.count({ where: { receiverId: user.id } }),
    ]);

    res.json({
      stats: {
        totalReceived: stats._sum.totalCoins || 0,
        totalGifts: stats._count,
      },
      topGifts: topGiftsWithDetails,
      transactions,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching received gifts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/gifts/recent — Get recent gifts on a story (for animation) ─────
router.get("/recent", async (req: Request, res: Response) => {
  try {
    const { storyId } = req.query;
    if (!storyId) return res.status(400).json({ error: "storyId is required" });

    // Get recent gifts (last 30 minutes) for this story to show animations
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const gifts = await prisma.giftTransaction.findMany({
      where: {
        storyId: storyId as string,
        createdAt: { gte: since },
      },
      include: {
        giftType: { select: { name: true, emoji: true, animationUrl: true } },
        sender: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    res.json({ gifts });
  } catch (error) {
    console.error("Error fetching recent gifts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
