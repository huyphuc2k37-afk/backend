import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";
import { splitRevenue } from "../lib/revenueSplit";

const router = Router();

async function createNotificationSafe(args: Parameters<typeof prisma.notification.create>[0]) {
  try {
    await prisma.notification.create(args);
  } catch (error) {
    console.warn("Notification create failed (ignored):", error);
  }
}

// ─── GET /api/authors/:id — hồ sơ tác giả công khai ──
router.get("/:id", async (req, res: Response) => {
  try {
    const author = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        image: true,
        bio: true,
        role: true,
        createdAt: true,
      },
    });

    if (!author || author.role !== "author") {
      return res.status(404).json({ error: "Author not found" });
    }

    const stories = await prisma.story.findMany({
      where: { authorId: author.id, approvalStatus: "approved" },
      select: {
        id: true,
        title: true,
        slug: true,
        genre: true,
        status: true,
        views: true,
        likes: true,
        updatedAt: true,
        _count: { select: { chapters: true, bookmarks: true, comments: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json({ author, stories });
  } catch (error) {
    console.error("Error fetching author profile:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/authors/:id/gift — tặng xu cho tác giả ──
router.post("/:id/gift", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const coinsRaw = req.body?.coins;
    const coins = typeof coinsRaw === "string" ? parseInt(coinsRaw, 10) : coinsRaw;

    if (!Number.isFinite(coins) || !Number.isInteger(coins) || coins <= 0) {
      return res.status(400).json({ error: "Coins must be a positive integer" });
    }
    if (coins > 100000) {
      return res.status(400).json({ error: "Tối đa 100,000 xu mỗi lần tặng" });
    }

    const [sender, author] = await Promise.all([
      prisma.user.findUnique({ where: { email: req.user!.email } }),
      prisma.user.findUnique({ where: { id: req.params.id } }),
    ]);

    if (!sender) return res.status(404).json({ error: "User not found" });
    if (!author || author.role !== "author") return res.status(404).json({ error: "Author not found" });
    if (sender.id === author.id) return res.status(400).json({ error: "Cannot gift to yourself" });

    if (sender.coinBalance < coins) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const split = splitRevenue(coins);

    const [updatedSender] = await prisma.$transaction([
      prisma.user.update({
        where: { id: sender.id },
        data: { coinBalance: { decrement: coins } },
        select: { coinBalance: true, id: true },
      }),
      prisma.user.update({
        where: { id: author.id },
        data: { coinBalance: { increment: split.author } },
        select: { id: true },
      }),
      prisma.authorEarning.create({
        data: {
          type: "tip",
          amount: split.author,
          authorId: author.id,
          fromUserId: sender.id,
        },
      }),
      prisma.platformEarning.create({
        data: {
          type: "gift",
          grossAmount: split.gross,
          authorAmount: split.author,
          platformAmount: split.platform,
          taxAmount: split.tax,
          authorId: author.id,
          fromUserId: sender.id,
        },
      }),
    ]);

    await createNotificationSafe({
      data: {
        userId: author.id,
        type: "wallet",
        title: "Bạn nhận được xu ủng hộ",
        message: `${sender.name} đã tặng bạn ${coins.toLocaleString("vi-VN")} xu để ủng hộ sáng tác. Bạn nhận được ${split.author.toLocaleString("vi-VN")} xu (đã trừ phí nền tảng & thuế).`,
        link: "/write/revenue",
      },
    });

    // Hoa hồng referral 1% thu nhập tác giả từ gift (nếu tác giả được giới thiệu)
    if (author.role === "author") {
      const authorObj = await prisma.user.findUnique({
        where: { id: author.id },
        select: { referredById: true },
      });
      if (authorObj?.referredById) {
        const referrer = await prisma.user.findUnique({
          where: { id: authorObj.referredById },
          select: { id: true, role: true },
        });
        if (referrer && (referrer.role === "author" || referrer.role === "admin")) {
          const commission = Math.floor(split.author * 0.01);
          if (commission >= 1) {
            await prisma.$transaction([
              prisma.user.update({
                where: { id: referrer.id },
                data: { coinBalance: { increment: commission } },
              }),
              prisma.referralEarning.create({
                data: {
                  type: "author_income_commission",
                  amount: commission,
                  sourceAmount: split.author,
                  rate: 0.01,
                  referrerId: referrer.id,
                  fromUserId: author.id,
                },
              }),
            ]);

            await createNotificationSafe({
              data: {
                userId: referrer.id,
                type: "wallet",
                title: "Hoa hồng giới thiệu — thu nhập tác giả",
                message: `Tác giả bạn giới thiệu vừa nhận ${split.author.toLocaleString("vi-VN")} xu ủng hộ. Bạn nhận được ${commission.toLocaleString("vi-VN")} xu hoa hồng (1%).`,
                link: "/profile",
              },
            });
          }
        }
      }
    }

    res.json({ success: true, senderBalance: updatedSender.coinBalance });
  } catch (error) {
    console.error("Error gifting coins:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
