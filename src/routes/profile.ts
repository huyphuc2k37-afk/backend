import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

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

    res.json(user);
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
      select: { role: true },
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

export default router;
