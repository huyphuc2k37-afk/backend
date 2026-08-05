import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// Tier thresholds (coins donated for tier)
const TIER_THRESHOLDS = {
  member: 0,
  vip: 500,      // 500 coins for VIP
  svip: 2000,    // 2000 coins for SVIP
};

// Calculate tier based on coins donated
function calculateTier(coins: number): string {
  if (coins >= TIER_THRESHOLDS.svip) return "svip";
  if (coins >= TIER_THRESHOLDS.vip) return "vip";
  return "member";
}

// ─── GET /api/fanclub/:authorId — Get fan club info ──
router.get("/:authorId", async (req, res: Response) => {
  try {
    const { authorId } = req.params;

    // Check if author exists and is actually an author
    const author = await prisma.user.findUnique({
      where: { id: authorId },
      select: {
        id: true,
        name: true,
        image: true,
        role: true,
      },
    });

    if (!author || author.role !== "author") {
      return res.status(404).json({ error: "Author not found" });
    }

    // Get or create fan club for this author
    let club = await prisma.fanClub.findUnique({
      where: { authorId },
    });

    // If club doesn't exist, create it
    if (!club) {
      club = await prisma.fanClub.create({
        data: {
          authorId,
          name: `Fan của ${author.name}`,
          description: "Cộng đồng fans của tác giả này",
        },
      });
    }

    res.json({ club, author });
  } catch (error) {
    console.error("Error fetching fan club:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/fanclub/:authorId/members — Get members ──
router.get("/:authorId/members", async (req, res: Response) => {
  try {
    const { authorId } = req.params;
    const { page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Get fan club
    const club = await prisma.fanClub.findUnique({ where: { authorId } });
    if (!club) {
      return res.status(404).json({ error: "Fan club not found" });
    }

    // Get members with pagination
    const [members, total] = await Promise.all([
      prisma.fanClubMember.findMany({
        where: { clubId: club.id },
        include: {
          user: {
            select: { id: true, name: true, image: true },
          },
        },
        orderBy: [{ tier: "desc" }, { tierCoins: "desc" }],
        skip,
        take: limitNum,
      }),
      prisma.fanClubMember.count({ where: { clubId: club.id } }),
    ]);

    res.json({
      members,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error fetching members:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/fanclub/:authorId/ranking — Get fan ranking ──
router.get("/:authorId/ranking", async (req, res: Response) => {
  try {
    const { authorId } = req.params;

    // Get fan club
    const club = await prisma.fanClub.findUnique({ where: { authorId } });
    if (!club) {
      return res.status(404).json({ error: "Fan club not found" });
    }

    // Get top fans by tierCoins
    const topFans = await prisma.fanClubMember.findMany({
      where: { clubId: club.id },
      include: {
        user: {
          select: { id: true, name: true, image: true },
        },
      },
      orderBy: { tierCoins: "desc" },
      take: 50,
    });

    // Add rank to each fan
    const rankedFans = topFans.map((fan, index) => ({
      ...fan,
      rank: index + 1,
    }));

    res.json({ ranking: rankedFans });
  } catch (error) {
    console.error("Error fetching ranking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/fanclub/:authorId/activities — Get recent activities ──
router.get("/:authorId/activities", async (req, res: Response) => {
  try {
    const { authorId } = req.params;
    const { limit = "20" } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));

    // Get fan club
    const club = await prisma.fanClub.findUnique({ where: { authorId } });
    if (!club) {
      return res.status(404).json({ error: "Fan club not found" });
    }

    // Get recent activities
    const activities = await prisma.fanClubActivity.findMany({
      where: { clubId: club.id },
      include: {
        user: {
          select: { id: true, name: true, image: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limitNum,
    });

    res.json({ activities });
  } catch (error) {
    console.error("Error fetching activities:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/fanclub/:authorId/join — Join fan club ──
router.post("/:authorId/join", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { authorId } = req.params;
    const userEmail = req.user!.email;

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if author exists
    const author = await prisma.user.findUnique({
      where: { id: authorId },
    });

    if (!author || author.role !== "author") {
      return res.status(404).json({ error: "Author not found" });
    }

    // Can't join own fan club
    if (user.id === authorId) {
      return res.status(400).json({ error: "Cannot join your own fan club" });
    }

    // Get or create fan club
    let club = await prisma.fanClub.findUnique({ where: { authorId } });
    if (!club) {
      club = await prisma.fanClub.create({
        data: {
          authorId,
          name: `Fan của ${author.name}`,
          description: "Cộng đồng fans của tác giả này",
        },
      });
    }

    // Check if already a member
    const existingMember = await prisma.fanClubMember.findUnique({
      where: { clubId_userId: { clubId: club.id, userId: user.id } },
    });

    if (existingMember) {
      return res.status(400).json({ error: "Already a member of this fan club" });
    }

    // Join the club
    const [member] = await prisma.$transaction([
      prisma.fanClubMember.create({
        data: {
          clubId: club.id,
          userId: user.id,
          tier: "member",
          tierCoins: 0,
        },
      }),
      prisma.fanClub.update({
        where: { id: club.id },
        data: { totalFans: { increment: 1 } },
      }),
      prisma.fanClubActivity.create({
        data: {
          clubId: club.id,
          userId: user.id,
          action: "joined",
          coins: 0,
        },
      }),
    ]);

    res.json({
      success: true,
      member,
      club: { ...club, totalFans: club.totalFans + 1 },
    });
  } catch (error) {
    console.error("Error joining fan club:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/fanclub/:authorId/leave — Leave fan club ──
router.post("/:authorId/leave", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { authorId } = req.params;
    const userEmail = req.user!.email;

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get fan club
    const club = await prisma.fanClub.findUnique({ where: { authorId } });
    if (!club) {
      return res.status(404).json({ error: "Fan club not found" });
    }

    // Check if member
    const member = await prisma.fanClubMember.findUnique({
      where: { clubId_userId: { clubId: club.id, userId: user.id } },
    });

    if (!member) {
      return res.status(400).json({ error: "Not a member of this fan club" });
    }

    // Leave the club
    await prisma.$transaction([
      prisma.fanClubMember.delete({
        where: { id: member.id },
      }),
      prisma.fanClub.update({
        where: { id: club.id },
        data: {
          totalFans: { decrement: 1 },
          totalCoins: { decrement: member.tierCoins },
        },
      }),
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error("Error leaving fan club:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/fanclub/:authorId/donate — Donate coins to tier up ──
router.post("/:authorId/donate", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { authorId } = req.params;
    const { coins } = req.body;
    const userEmail = req.user!.email;

    // Validate coins
    const coinAmount = typeof coins === "string" ? parseInt(coins, 10) : coins;
    if (!Number.isFinite(coinAmount) || !Number.isInteger(coinAmount) || coinAmount <= 0) {
      return res.status(400).json({ error: "Coins must be a positive integer" });
    }
    if (coinAmount > 100000) {
      return res.status(400).json({ error: "Tối đa 100,000 xu mỗi lần donate" });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if author exists
    const author = await prisma.user.findUnique({
      where: { id: authorId },
    });

    if (!author || author.role !== "author") {
      return res.status(404).json({ error: "Author not found" });
    }

    // Can't donate to own fan club
    if (user.id === authorId) {
      return res.status(400).json({ error: "Cannot donate to your own fan club" });
    }

    // Check balance
    if (user.coinBalance < coinAmount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Get or create fan club
    let club = await prisma.fanClub.findUnique({ where: { authorId } });
    if (!club) {
      club = await prisma.fanClub.create({
        data: {
          authorId,
          name: `Fan của ${author.name}`,
          description: "Cộng đồng fans của tác giả này",
        },
      });
    }

    // Get or create membership
    let member = await prisma.fanClubMember.findUnique({
      where: { clubId_userId: { clubId: club.id, userId: user.id } },
    });

    if (!member) {
      member = await prisma.fanClubMember.create({
        data: {
          clubId: club.id,
          userId: user.id,
          tier: "member",
          tierCoins: 0,
        },
      });
      // Increment fan count
      await prisma.fanClub.update({
        where: { id: club.id },
        data: { totalFans: { increment: 1 } },
      });
    }

    // Calculate new tier
    const newTierCoins = member.tierCoins + coinAmount;
    const newTier = calculateTier(newTierCoins);
    const oldTier = member.tier;
    const tierUpgraded = newTier !== oldTier;

    // Transaction: deduct coins, update member, add activity, update club stats
    const [updatedMember] = await prisma.$transaction([
      prisma.fanClubMember.update({
        where: { id: member.id },
        data: {
          tierCoins: newTierCoins,
          tier: newTier,
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { coinBalance: { decrement: coinAmount } },
      }),
      prisma.user.update({
        where: { id: authorId },
        data: { coinBalance: { increment: coinAmount } },
      }),
      prisma.fanClub.update({
        where: { id: club.id },
        data: { totalCoins: { increment: coinAmount } },
      }),
      prisma.fanClubActivity.create({
        data: {
          clubId: club.id,
          userId: user.id,
          action: tierUpgraded ? "upgraded" : "donated",
          coins: coinAmount,
        },
      }),
    ]);

    // Create notification for author
    try {
      await prisma.notification.create({
        data: {
          userId: authorId,
          type: "wallet",
          title: "Fan Club donation",
          message: `${user.name} đã donate ${coinAmount.toLocaleString("vi-VN")} xu vào Fan Club của bạn! ${tierUpgraded ? `Họ đã lên tier ${newTier.toUpperCase()}!` : ""}`,
          link: `/fanclub/${authorId}`,
        },
      });
    } catch (notifError) {
      console.warn("Failed to create notification:", notifError);
    }

    res.json({
      success: true,
      member: updatedMember,
      tierUpgraded,
      oldTier,
      newTier,
    });
  } catch (error) {
    console.error("Error donating to fan club:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/fanclub/:authorId/mystatus — Get current user's membership status ──
router.get("/:authorId/mystatus", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { authorId } = req.params;
    const userEmail = req.user!.email;

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get fan club
    const club = await prisma.fanClub.findUnique({ where: { authorId } });
    if (!club) {
      return res.json({ isMember: false, member: null });
    }

    // Get membership
    const member = await prisma.fanClubMember.findUnique({
      where: { clubId_userId: { clubId: club.id, userId: user.id } },
    });

    res.json({
      isMember: !!member,
      member,
    });
  } catch (error) {
    console.error("Error fetching membership status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
