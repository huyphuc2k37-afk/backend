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
  req.adminUser = user;
  next();
}

// ─── POST /api/admin/badges/award — Award a badge to an author ──
router.post("/badges/award", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { authorId, badgeType, expiresInDays } = req.body;

    if (!authorId || !badgeType) {
      return res.status(400).json({ error: "authorId và badgeType là bắt buộc" });
    }

    // Validate badge type
    const validBadgeTypes = [
      "top_author",
      "trending",
      "verified",
      "rising_star",
      "prolific",
      "legendary",
      "vip",
      "contest_winner",
      "community_hero",
    ];

    if (!validBadgeTypes.includes(badgeType)) {
      return res.status(400).json({
        error: `badgeType không hợp lệ. Các loại hợp lệ: ${validBadgeTypes.join(", ")}`,
      });
    }

    // Check if author exists
    const author = await prisma.user.findUnique({
      where: { id: authorId },
      select: { id: true, name: true, role: true },
    });

    if (!author || author.role !== "author") {
      return res.status(404).json({ error: "Tác giả không tồn tại" });
    }

    // Calculate expiration date if specified
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    // Check for existing active badge of same type
    const existingBadge = await prisma.authorBadge.findFirst({
      where: {
        authorId,
        badgeType,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    if (existingBadge) {
      return res.status(400).json({
        error: `Tác giả đã có badge "${badgeType}" đang hoạt động`,
      });
    }

    // Create the badge
    const badge = await prisma.authorBadge.create({
      data: {
        authorId,
        badgeType,
        expiresAt,
      },
    });

    // Send notification to author
    const badgeNames: Record<string, string> = {
      top_author: "Tác giả hàng đầu",
      trending: "Xu hướng",
      verified: "Đã xác minh",
      rising_star: "Sao đang lên",
      prolific: "Siêu năng suất",
      legendary: "Huyền thoại",
      vip: "VIP",
      contest_winner: "Giải thưởng cuộc thi",
      community_hero: "Anh hùng cộng đồng",
    };

    try {
      await prisma.notification.create({
        data: {
          userId: authorId,
          type: "system",
          title: "Bạn nhận được badge mới!",
          message: `Chúc mừng! Bạn đã được trao badge "${badgeNames[badgeType] || badgeType}".`,
          link: "/profile",
        },
      });
    } catch (notifErr) {
      console.warn("Badge notification failed:", notifErr);
    }

    res.json({
      success: true,
      badge,
      authorName: author.name,
    });
  } catch (error) {
    console.error("Error awarding badge:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/admin/badges/:badgeId — Revoke a badge ──
router.delete("/badges/:badgeId", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { badgeId } = req.params;

    const badge = await prisma.authorBadge.findUnique({
      where: { id: badgeId },
      include: { author: { select: { id: true, name: true } } },
    });

    if (!badge) {
      return res.status(404).json({ error: "Badge không tồn tại" });
    }

    await prisma.authorBadge.delete({
      where: { id: badgeId },
    });

    // Notify author
    try {
      await prisma.notification.create({
        data: {
          userId: badge.authorId,
          type: "system",
          title: "Badge đã bị thu hồi",
          message: `Badge "${badge.badgeType}" đã được thu hồi.`,
        },
      });
    } catch (notifErr) {
      console.warn("Badge revocation notification failed:", notifErr);
    }

    res.json({
      success: true,
      message: `Đã thu hồi badge của tác giả ${badge.author.name}`,
    });
  } catch (error) {
    console.error("Error revoking badge:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/badges — List all badges ──
router.get("/badges", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const badgeType = req.query.badgeType as string | undefined;

    const where = badgeType ? { badgeType } : {};

    const [badges, total] = await Promise.all([
      prisma.authorBadge.findMany({
        where,
        include: {
          author: {
            select: { id: true, name: true, image: true, role: true },
          },
        },
        orderBy: { earnedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.authorBadge.count({ where }),
    ]);

    res.json({ badges, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("Error fetching badges:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/badges/authors — Get authors by level ──
router.get("/badges/authors", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const authors = await prisma.user.findMany({
      where: { role: "author" },
      select: {
        id: true,
        name: true,
        image: true,
        _count: { select: { stories: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Calculate level for each author
    const authorsWithLevels = await Promise.all(
      authors.map(async (author) => {
        const [stories, earningsAgg] = await Promise.all([
          prisma.story.findMany({
            where: { authorId: author.id, approvalStatus: "approved" },
            select: { views: true },
          }),
          prisma.authorEarning.aggregate({
            where: { authorId: author.id },
            _sum: { amount: true },
          }),
        ]);

        const totalViews = stories.reduce((sum, s) => sum + s.views, 0);
        const totalEarnings = earningsAgg._sum.amount || 0;

        const level = await prisma.authorLevel.findFirst({
          where: {},
          orderBy: { level: "desc" },
        });

        // Find current level
        const levels = await prisma.authorLevel.findMany({
          orderBy: { level: "desc" },
        });

        let currentLevel = levels[levels.length - 1];
        for (const l of levels) {
          if (
            totalViews >= l.minViews &&
            author._count.stories >= l.minStories &&
            totalEarnings >= l.minEarnings
          ) {
            currentLevel = l;
            break;
          }
        }

        return {
          ...author,
          stats: {
            views: totalViews,
            stories: author._count.stories,
            earnings: totalEarnings,
          },
          level: currentLevel,
        };
      })
    );

    res.json({ authors: authorsWithLevels });
  } catch (error) {
    console.error("Error fetching authors with levels:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
