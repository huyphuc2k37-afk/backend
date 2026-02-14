import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

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

    const [updatedSender] = await prisma.$transaction([
      prisma.user.update({
        where: { id: sender.id },
        data: { coinBalance: { decrement: coins } },
        select: { coinBalance: true, id: true },
      }),
      prisma.user.update({
        where: { id: author.id },
        data: { coinBalance: { increment: coins } },
        select: { id: true },
      }),
    ]);

    await createNotificationSafe({
      data: {
        userId: author.id,
        type: "wallet",
        title: "Bạn nhận được xu ủng hộ",
        message: `${sender.name} đã tặng bạn ${coins.toLocaleString("vi-VN")} xu để ủng hộ sáng tác.`,
        link: "/write/revenue",
      },
    });

    res.json({ success: true, senderBalance: updatedSender.coinBalance });
  } catch (error) {
    console.error("Error gifting coins:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
