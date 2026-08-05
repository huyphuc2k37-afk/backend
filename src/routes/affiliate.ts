import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired, authOptional } from "../middleware/auth";
import { extractClientIP } from "../lib/ip";

const router = Router();

// ─── Commission rates ────────────────────────────────────────────────────────
const COMMISSION_RATES = {
  signup: 10,        // 10 coins for new user signup
  first_purchase: 50, // 50 coins for first deposit
  view_milestone: 5, // 5 coins per 10 views milestone
  referral_read: 1,   // 1 coin per 10 chapters read
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function generateAffiliateCode(userId: string, destination: string, targetId?: string): string {
  const prefix = destination.substring(0, 3).toUpperCase();
  const timestamp = Date.now().toString(36);
  const hash = Buffer.from(`${userId}:${targetId || ""}:${timestamp}`).toString("base64url").substring(0, 6);
  return `${prefix}-${hash}`.toUpperCase();
}

function getDestinationTitle(destination: string, targetId: string | undefined): string | undefined {
  if (!targetId) return undefined;
  
  if (destination === "story") {
    return undefined; // Will be fetched from DB
  }
  if (destination === "author") {
    return undefined; // Will be fetched from DB
  }
  return undefined;
}

// ─── POST /api/affiliate/create-link ─────────────────────────────────────────
// Create a new affiliate link
router.post("/create-link", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const { destination, targetId } = req.body;

    if (!destination || !["story", "author", "campaign", "page"].includes(destination)) {
      return res.status(400).json({ error: "Invalid destination type" });
    }

    // Check if user already has a link for this destination/target
    const existingLink = await prisma.affiliateLink.findFirst({
      where: {
        userId: user.id,
        destination,
        targetId: targetId || null,
      },
    });

    if (existingLink) {
      return res.json({
        link: existingLink,
        message: "Link already exists",
      });
    }

    // Generate unique code
    let code = generateAffiliateCode(user.id, destination, targetId);
    let attempts = 0;
    while (attempts < 10) {
      const exists = await prisma.affiliateLink.findUnique({ where: { code } });
      if (!exists) break;
      code = generateAffiliateCode(user.id, destination, targetId + attempts);
      attempts++;
    }

    // Fetch target title for stories/authors
    let targetTitle: string | undefined;
    if (destination === "story" && targetId) {
      const story = await prisma.story.findUnique({
        where: { id: targetId },
        select: { title: true },
      });
      targetTitle = story?.title;
    } else if (destination === "author" && targetId) {
      const author = await prisma.user.findUnique({
        where: { id: targetId },
        select: { name: true },
      });
      targetTitle = author?.name;
    }

    const link = await prisma.affiliateLink.create({
      data: {
        userId: user.id,
        code,
        destination,
        targetId: targetId || null,
        targetTitle: targetTitle || null,
      },
    });

    res.status(201).json({ link });
  } catch (error) {
    console.error("Error creating affiliate link:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/affiliate/links ─────────────────────────────────────────────────
// Get all affiliate links for the current user
router.get("/links", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const links = await prisma.affiliateLink.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    res.json({ links });
  } catch (error) {
    console.error("Error fetching affiliate links:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/affiliate/stats ─────────────────────────────────────────────────
// Get affiliate statistics for the current user
router.get("/stats", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Get link stats
    const links = await prisma.affiliateLink.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        clickCount: true,
        conversionCount: true,
      },
    });

    const totalClicks = links.reduce((sum, l) => sum + l.clickCount, 0);
    const totalConversions = links.reduce((sum, l) => sum + l.conversionCount, 0);

    // Get earnings stats
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [totalEarnings, recentEarnings, thisMonthEarnings, referralCount] = await Promise.all([
      prisma.affiliateEarning.aggregate({
        where: { userId: user.id },
        _sum: { commission: true },
      }),
      prisma.affiliateEarning.findMany({
        where: {
          userId: user.id,
          createdAt: { gte: thirtyDaysAgo },
        },
        select: { commission: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.affiliateEarning.aggregate({
        where: {
          userId: user.id,
          createdAt: { gte: new Date(new Date().setDate(1)) },
        },
        _sum: { commission: true },
      }),
      prisma.affiliateEarning.groupBy({
        by: ["referralUserId"],
        where: { userId: user.id },
        _count: { referralUserId: true },
      }),
    ]);

    // Calculate daily earnings for chart (last 30 days)
    const dailyEarnings: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = date.toISOString().split("T")[0];
      dailyEarnings[key] = 0;
    }
    recentEarnings.forEach((e) => {
      const key = e.createdAt.toISOString().split("T")[0];
      if (dailyEarnings[key] !== undefined) {
        dailyEarnings[key] += e.commission;
      }
    });

    res.json({
      totalClicks,
      totalConversions,
      totalEarnings: totalEarnings._sum.commission || 0,
      thisMonthEarnings: thisMonthEarnings._sum.commission || 0,
      totalLinks: links.length,
      totalReferrals: referralCount.length,
      conversionRate: totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(2) : "0",
      dailyEarnings,
    });
  } catch (error) {
    console.error("Error fetching affiliate stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/affiliate/earnings ───────────────────────────────────────────────
// Get earnings history for the current user
router.get("/earnings", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [earnings, total] = await Promise.all([
      prisma.affiliateEarning.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          referralUser: {
            select: { id: true, name: true, email: true },
          },
          link: {
            select: { code: true, destination: true, targetTitle: true },
          },
        },
      }),
      prisma.affiliateEarning.count({ where: { userId: user.id } }),
    ]);

    res.json({
      earnings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching affiliate earnings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/affiliate/leaderboard ──────────────────────────────────────────
// Get top affiliates leaderboard
router.get("/leaderboard", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    const leaders = await prisma.affiliateEarning.groupBy({
      by: ["userId"],
      _sum: { commission: true },
      _count: { id: true },
      orderBy: { _sum: { commission: "desc" } },
      take: limit,
    });

    const leaderIds = leaders.map((l) => l.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: leaderIds } },
      select: { id: true, name: true, image: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));
    const leaderboard = leaders.map((l, idx) => {
      const userData = userMap.get(l.userId);
      return {
        rank: idx + 1,
        userId: l.userId,
        name: userData?.name || "Unknown",
        image: userData?.image,
        totalEarnings: l._sum.commission || 0,
        totalActions: l._count.id,
      };
    });

    res.json({ leaderboard });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/affiliate/track/:code ───────────────────────────────────────────
// Track a click and redirect to the destination
router.get("/track/:code", authOptional, async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.params;
    const ip = extractClientIP(req);
    const userAgent = req.headers["user-agent"] || "";
    const referer = req.headers["referer"] || "";

    const link = await prisma.affiliateLink.findUnique({
      where: { code },
    });

    if (!link || !link.isActive) {
      return res.redirect("/");
    }

    // Record the click
    await prisma.affiliateClick.create({
      data: {
        linkId: link.id,
        userId: req.user?.sub || null,
        ip: ip || null,
        userAgent: userAgent.substring(0, 500),
        referer: referer.substring(0, 500),
      },
    });

    // Increment click count
    await prisma.affiliateLink.update({
      where: { id: link.id },
      data: { clickCount: { increment: 1 } },
    });

    // Determine redirect URL
    let redirectUrl = "/";
    switch (link.destination) {
      case "story":
        if (link.targetId) {
          const story = await prisma.story.findUnique({
            where: { id: link.targetId },
            select: { slug: true, approvalStatus: true },
          });
          if (story && story.approvalStatus === "approved") {
            redirectUrl = `/story/${story.slug}`;
          }
        }
        break;
      case "author":
        if (link.targetId) {
          const author = await prisma.user.findUnique({
            where: { id: link.targetId },
            select: { name: true },
          });
          if (author) {
            redirectUrl = `/author/${encodeURIComponent(author.name)}`;
          }
        }
        break;
      case "campaign":
      case "page":
        redirectUrl = link.targetId ? `/${link.targetId}` : "/";
        break;
    }

    res.redirect(redirectUrl);
  } catch (error) {
    console.error("Error tracking affiliate click:", error);
    res.redirect("/");
  }
});

// ─── POST /api/affiliate/record-action ─────────────────────────────────────────
// Record a conversion action (called internally when user signs up, deposits, etc.)
router.post("/record-action", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const { action, referralCode, referralUserId, linkId, description } = req.body;

    if (!action || !["signup", "first_purchase", "view_milestone", "referral_read"].includes(action)) {
      return res.status(400).json({ error: "Invalid action type" });
    }

    let affiliateUserId: string | undefined;
    let affiliateLinkId: string | undefined;

    // Find the affiliate who referred this user
    if (referralCode) {
      const link = await prisma.affiliateLink.findUnique({
        where: { code: referralCode },
      });
      if (link && link.isActive) {
        affiliateUserId = link.userId;
        affiliateLinkId = link.id;
      }
    } else if (referralUserId) {
      affiliateUserId = referralUserId;
    } else if (linkId) {
      const link = await prisma.affiliateLink.findUnique({
        where: { id: linkId },
      });
      if (link && link.isActive) {
        affiliateUserId = link.userId;
        affiliateLinkId = link.id;
      }
    }

    // Don't credit self-referrals
    if (affiliateUserId === user.id) {
      return res.json({ message: "Self-referral not credited", credited: false });
    }

    if (!affiliateUserId) {
      return res.json({ message: "No affiliate found", credited: false });
    }

    // Calculate commission based on action
    let commission = 0;
    switch (action) {
      case "signup":
        commission = COMMISSION_RATES.signup;
        break;
      case "first_purchase":
        commission = COMMISSION_RATES.first_purchase;
        // Increment conversion count on affiliate link
        if (affiliateLinkId) {
          await prisma.affiliateLink.update({
            where: { id: affiliateLinkId },
            data: { conversionCount: { increment: 1 } },
          });
        }
        break;
      case "view_milestone":
        commission = COMMISSION_RATES.view_milestone;
        break;
      case "referral_read":
        commission = COMMISSION_RATES.referral_read;
        break;
    }

    // Create earning record
    const earning = await prisma.affiliateEarning.create({
      data: {
        userId: affiliateUserId,
        referralUserId: user.id,
        linkId: affiliateLinkId || null,
        action,
        commission,
        description: description || `${action} - referred user`,
      },
    });

    // Credit the affiliate's coin balance
    await prisma.user.update({
      where: { id: affiliateUserId },
      data: { coinBalance: { increment: commission } },
    });

    // Create notification for affiliate
    await prisma.notification.create({
      data: {
        userId: affiliateUserId,
        title: "Hoa hồng liên kết",
        message: `Bạn nhận được ${commission} xu hoa hồng từ ${action}`,
        type: "wallet",
      },
    });

    res.json({
      credited: true,
      earning,
      commission,
    });
  } catch (error) {
    console.error("Error recording affiliate action:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/affiliate/link/:id ────────────────────────────────────────────
// Delete/deactivate an affiliate link
router.delete("/link/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const link = await prisma.affiliateLink.findUnique({
      where: { id: req.params.id },
    });

    if (!link) {
      return res.status(404).json({ error: "Link not found" });
    }

    if (link.userId !== user.id) {
      return res.status(403).json({ error: "Not authorized to delete this link" });
    }

    await prisma.affiliateLink.update({
      where: { id: link.id },
      data: { isActive: false },
    });

    res.json({ message: "Link deactivated successfully" });
  } catch (error) {
    console.error("Error deleting affiliate link:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
