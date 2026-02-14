import { Router, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ─── Moderator middleware ────────────────────────
async function modRequired(req: AuthRequest, res: Response, next: NextFunction) {
  const user = await prisma.user.findUnique({
    where: { email: req.user!.email },
  });
  if (!user || (user.role !== "moderator" && user.role !== "admin")) {
    return res.status(403).json({ error: "Moderator access required" });
  }
  (req as any).modUser = user;
  next();
}

// ─── GET /api/mod/stats — thống kê kiểm duyệt ──
router.get("/stats", authRequired, modRequired, async (_req: AuthRequest, res: Response) => {
  try {
    const [pending, approved, rejected, todayReviewed] = await Promise.all([
      prisma.story.count({ where: { approvalStatus: "pending" } }),
      prisma.story.count({ where: { approvalStatus: "approved" } }),
      prisma.story.count({ where: { approvalStatus: "rejected" } }),
      prisma.story.count({
        where: {
          reviewedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          approvalStatus: { in: ["approved", "rejected"] },
        },
      }),
    ]);

    res.json({ pending, approved, rejected, todayReviewed });
  } catch (error) {
    console.error("Error fetching mod stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/mod/stories — danh sách truyện cần duyệt ──
router.get("/stories", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = (req.query.status as string) || "pending"; // pending | approved | rejected | all
    const search = (req.query.search as string) || "";

    const where: any = {};
    if (status !== "all") where.approvalStatus = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { author: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [stories, total] = await Promise.all([
      prisma.story.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          genre: true,
          tags: true,
          status: true,
          isAdult: true,
          approvalStatus: true,
          rejectionReason: true,
          reviewedBy: true,
          reviewedAt: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, email: true, image: true } },
          _count: { select: { chapters: true } },
        },
      }),
      prisma.story.count({ where }),
    ]);

    res.json({ stories, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("Error fetching mod stories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/mod/stories/:id — xem chi tiết 1 truyện để duyệt ──
router.get("/stories/:id", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        coverImage: true,
        genre: true,
        tags: true,
        status: true,
        isAdult: true,
        approvalStatus: true,
        rejectionReason: true,
        reviewedBy: true,
        reviewedAt: true,
        targetAudience: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, name: true, email: true, image: true } },
        chapters: {
          select: { id: true, title: true, number: true, wordCount: true, createdAt: true },
          orderBy: { number: "asc" },
        },
        _count: { select: { chapters: true, bookmarks: true, comments: true } },
      },
    });

    if (!story) return res.status(404).json({ error: "Story not found" });
    res.json(story);
  } catch (error) {
    console.error("Error fetching story detail:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/mod/stories/:id/approve — duyệt truyện ──
router.put("/stories/:id/approve", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const modUser = (req as any).modUser;
    const story = await prisma.story.findUnique({ where: { id: req.params.id } });
    if (!story) return res.status(404).json({ error: "Story not found" });

    const updated = await prisma.story.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "approved",
        rejectionReason: null,
        reviewedBy: modUser.id,
        reviewedAt: new Date(),
      },
    });

    // Notify the author
    try {
      await prisma.notification.create({
        data: {
          userId: story.authorId,
          type: "system",
          title: "Truyện đã được duyệt ✅",
          message: `Truyện "${story.title}" của bạn đã được kiểm duyệt viên phê duyệt và hiện đang hiển thị công khai.`,
          link: `/story/${story.slug}`,
        },
      });
    } catch {}

    res.json({ message: "Đã duyệt truyện", story: updated });
  } catch (error) {
    console.error("Error approving story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/mod/stories/:id/reject — từ chối truyện ──
router.put("/stories/:id/reject", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const modUser = (req as any).modUser;
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "Vui lòng nhập lý do từ chối" });
    }

    const story = await prisma.story.findUnique({ where: { id: req.params.id } });
    if (!story) return res.status(404).json({ error: "Story not found" });

    const updated = await prisma.story.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "rejected",
        rejectionReason: reason.trim(),
        reviewedBy: modUser.id,
        reviewedAt: new Date(),
      },
    });

    // Notify the author
    try {
      await prisma.notification.create({
        data: {
          userId: story.authorId,
          type: "system",
          title: "Truyện bị từ chối ❌",
          message: `Truyện "${story.title}" không được duyệt. Lý do: ${reason.trim()}`,
          link: `/write/${story.id}`,
        },
      });
    } catch {}

    res.json({ message: "Đã từ chối truyện", story: updated });
  } catch (error) {
    console.error("Error rejecting story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
