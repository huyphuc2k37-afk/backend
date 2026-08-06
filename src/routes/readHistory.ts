import { Router, type Response } from "express";
import prisma from "../lib/prisma";
import { authRequired, type AuthRequest } from "../middleware/auth";

const router = Router();

// POST /api/read-history — Track that a user read a chapter (upserts ReadHistory row)
router.post("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { storyId, chapterId } = req.body ?? {};
    if (!storyId || !chapterId) {
      return res.status(400).json({ error: "storyId and chapterId are required" });
    }
    if (!req.user?.email) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await prisma.user.findUnique({
      where: { email: req.user.email },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { id: true },
    });
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    const row = await prisma.readHistory.upsert({
      where: { userId_storyId: { userId: user.id, storyId } },
      update: {
        chapterId,
        lastReadAt: new Date(),
      },
      create: {
        userId: user.id,
        storyId,
        chapterId,
        lastReadAt: new Date(),
      },
    });

    res.json({ ok: true, id: row.id, lastReadAt: row.lastReadAt });
  } catch (err) {
    console.error("[read-history] error:", err);
    res.status(500).json({ error: "Failed to record read history" });
  }
});

// GET /api/read-history — List a user's recent reads (for recommender / profile)
router.get("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.email) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await prisma.user.findUnique({
      where: { email: req.user.email },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);

    const history = await prisma.readHistory.findMany({
      where: { userId: user.id },
      orderBy: { lastReadAt: "desc" },
      take: limit,
      include: {
        story: { select: { id: true, title: true, slug: true, coverImage: true } },
      },
    });

    res.json({ history });
  } catch (err) {
    console.error("[read-history] list error:", err);
    res.status(500).json({ error: "Failed to fetch read history" });
  }
});

export default router;
