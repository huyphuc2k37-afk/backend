import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

/** Derive a direct cover URL from a Story record */
function deriveCoverUrl(story: { coverImage?: string | null; coverApprovalStatus?: string; approvalStatus?: string }): string | null {
  if (!story.coverImage) return null;
  if (story.coverApprovalStatus === "rejected") return null;
  if (story.approvalStatus !== "approved" && story.coverApprovalStatus !== "approved") return null;
  if (story.coverImage.startsWith("http://") || story.coverImage.startsWith("https://")) {
    return story.coverImage;
  }
  return null;
}

// GET /api/bookmarks/check?storyId=xxx — check if story is bookmarked
router.get("/check", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const storyId = req.query.storyId as string;
    if (!storyId) return res.status(400).json({ error: "storyId required" });

    const bookmark = await prisma.bookmark.findUnique({
      where: { userId_storyId: { userId: user.id, storyId } },
      select: { id: true },
    });

    res.json({ bookmarked: !!bookmark });
  } catch (error) {
    console.error("Error checking bookmark:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/bookmarks — get user's bookmarks
router.get("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: user.id },
      include: {
        story: {
          select: {
            id: true,
            title: true,
            slug: true,
            genre: true,
            status: true,
            views: true,
            coverImage: true,
            coverApprovalStatus: true,
            approvalStatus: true,
            author: { select: { id: true, name: true, image: true } },
            _count: { select: { chapters: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // Map to include coverUrl and strip raw cover fields
    const mapped = bookmarks.map((bm: any) => {
      const { coverImage, coverApprovalStatus, approvalStatus, ...storyRest } = bm.story;
      return {
        ...bm,
        story: { ...storyRest, coverUrl: deriveCoverUrl(bm.story) },
      };
    });

    res.json(mapped);
  } catch (error) {
    console.error("Error fetching bookmarks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/bookmarks — toggle bookmark
router.post("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { storyId } = req.body;
    if (!storyId) return res.status(400).json({ error: "storyId is required" });

    // Only allow bookmarking approved stories
    const story = await prisma.story.findUnique({ where: { id: storyId }, select: { approvalStatus: true } });
    if (!story || story.approvalStatus !== "approved") {
      return res.status(403).json({ error: "Truyện chưa được duyệt" });
    }

    const existing = await prisma.bookmark.findUnique({
      where: { userId_storyId: { userId: user.id, storyId } },
    });

    if (existing) {
      // Remove bookmark (toggle)
      await prisma.bookmark.delete({ where: { id: existing.id } });
      return res.json({ bookmarked: false });
    }

    try {
      await prisma.bookmark.create({
        data: { userId: user.id, storyId },
      });
    } catch (err: any) {
      // Handle race condition: unique constraint violation means already bookmarked
      if (err.code === "P2002") {
        return res.json({ bookmarked: true });
      }
      throw err;
    }

    res.json({ bookmarked: true });
  } catch (error) {
    console.error("Error toggling bookmark:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/bookmarks/:storyId — remove bookmark
router.delete("/:storyId", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const { storyId } = req.params;
    const existing = await prisma.bookmark.findUnique({
      where: { userId_storyId: { userId: user.id, storyId } },
    });

    if (!existing) return res.json({ bookmarked: false });

    await prisma.bookmark.delete({ where: { id: existing.id } });
    res.json({ bookmarked: false });
  } catch (error) {
    console.error("Error removing bookmark:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
