import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// GET /api/follows/check?authorId=xxx — check if current user follows this author
router.get("/check", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const authorId = req.query.authorId as string;
    if (!authorId) return res.status(400).json({ error: "authorId required" });

    const follow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: user.id, followingId: authorId } },
      select: { id: true },
    });

    res.json({ following: !!follow });
  } catch (error) {
    console.error("Error checking follow:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/follows/count?authorId=xxx — get follower count for an author
router.get("/count", async (req, res) => {
  try {
    const authorId = req.query.authorId as string;
    if (!authorId) return res.status(400).json({ error: "authorId required" });

    const count = await prisma.follow.count({
      where: { followingId: authorId },
    });

    res.json({ count });
  } catch (error) {
    console.error("Error counting followers:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/follows — follow an author
router.post("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const { authorId } = req.body;
    if (!authorId) return res.status(400).json({ error: "authorId required" });

    // Can't follow yourself
    if (user.id === authorId) {
      return res.status(400).json({ error: "Cannot follow yourself" });
    }

    // Check if author exists and is actually an author/moderator/admin
    const author = await prisma.user.findUnique({
      where: { id: authorId },
      select: { id: true, role: true },
    });
    if (!author) return res.status(404).json({ error: "Author not found" });
    if (author.role === "reader") {
      return res.status(400).json({ error: "Chỉ có thể theo dõi tác giả" });
    }

    // Upsert to avoid duplicate errors
    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId: user.id, followingId: authorId } },
      create: { followerId: user.id, followingId: authorId },
      update: {},  // already following, do nothing
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error following author:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/follows/:authorId — unfollow an author
router.delete("/:authorId", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const authorId = req.params.authorId;

    await prisma.follow.deleteMany({
      where: { followerId: user.id, followingId: authorId },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error unfollowing author:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
