import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET /api/comments?storyId=xxx — get comments for a story
router.get("/", async (req: Request, res: Response) => {
  try {
    const { storyId } = req.query;
    if (!storyId) {
      return res.status(400).json({ error: "storyId is required" });
    }

    const comments = await prisma.comment.findMany({
      where: { storyId: storyId as string },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(comments);
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/comments — create a comment (requires auth handled via body email for now)
router.post("/", async (req: Request, res: Response) => {
  try {
    const { storyId, content, userEmail } = req.body;
    if (!storyId || !content || !userEmail) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const comment = await prisma.comment.create({
      data: {
        content,
        userId: user.id,
        storyId,
      },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
    });

    res.status(201).json(comment);
  } catch (error) {
    console.error("Error creating comment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
