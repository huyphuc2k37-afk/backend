import { Router, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";
import { invalidateCache } from "../lib/cache";

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
    const [pending, approved, rejected, todayReviewed, chapterPending] = await Promise.all([
      prisma.story.count({ where: { approvalStatus: "pending" } }),
      prisma.story.count({ where: { approvalStatus: "approved" } }),
      prisma.story.count({ where: { approvalStatus: "rejected" } }),
      prisma.story.count({
        where: {
          reviewedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          approvalStatus: { in: ["approved", "rejected"] },
        },
      }),
      prisma.chapter.count({ where: { approvalStatus: "pending" } }),
    ]);

    res.json({ pending, approved, rejected, todayReviewed, chapterPending });
  } catch (error) {
    console.error("Error fetching mod stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/mod/stories — danh sách truyện cần duyệt ──
router.get("/stories", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const status = (req.query.status as string) || "pending";
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
          select: { id: true, title: true, number: true, wordCount: true, approvalStatus: true, createdAt: true },
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

    // Prevent self-moderation
    if (story.authorId === modUser.id) {
      return res.status(403).json({ error: "Không thể duyệt truyện của chính mình" });
    }

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
    invalidateCache(`story:${story.slug}`, "stories:*", "ranking:*");
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

    // Prevent self-moderation
    if (story.authorId === modUser.id) {
      return res.status(403).json({ error: "Không thể từ chối truyện của chính mình" });
    }

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

// ═══════════════════════════════════════════════════
// ─── CHAPTER MODERATION ──────────────────────────
// ═══════════════════════════════════════════════════

// ─── GET /api/mod/chapters/stats — thống kê chương ──
router.get("/chapters/stats", authRequired, modRequired, async (_req: AuthRequest, res: Response) => {
  try {
    const [pending, approved, rejected, todayReviewed] = await Promise.all([
      prisma.chapter.count({ where: { approvalStatus: "pending" } }),
      prisma.chapter.count({ where: { approvalStatus: "approved" } }),
      prisma.chapter.count({ where: { approvalStatus: "rejected" } }),
      prisma.chapter.count({
        where: {
          reviewedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          approvalStatus: { in: ["approved", "rejected"] },
        },
      }),
    ]);
    res.json({ pending, approved, rejected, todayReviewed });
  } catch (error) {
    console.error("Error fetching chapter stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/mod/chapters — danh sách chương cần duyệt ──
router.get("/chapters", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const status = (req.query.status as string) || "pending";
    const search = (req.query.search as string) || "";

    const where: any = {};
    if (status !== "all") where.approvalStatus = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { story: { title: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [chapters, total] = await Promise.all([
      prisma.chapter.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          number: true,
          wordCount: true,
          approvalStatus: true,
          rejectionReason: true,
          reviewedAt: true,
          createdAt: true,
          story: {
            select: {
              id: true,
              title: true,
              slug: true,
              author: { select: { id: true, name: true, email: true } },
            },
          },
        },
      }),
      prisma.chapter.count({ where }),
    ]);

    res.json({ chapters, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("Error fetching mod chapters:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/mod/chapters/:id — xem chi tiết chương để duyệt ──
router.get("/chapters/:id", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const chapter = await prisma.chapter.findUnique({
      where: { id: req.params.id },
      include: {
        story: {
          select: {
            id: true,
            title: true,
            slug: true,
            genre: true,
            author: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    res.json(chapter);
  } catch (error) {
    console.error("Error fetching chapter detail:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/mod/chapters/:id/approve — duyệt chương ──
router.put("/chapters/:id/approve", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const modUser = (req as any).modUser;
    const chapter = await prisma.chapter.findUnique({
      where: { id: req.params.id },
      include: { story: { select: { title: true, authorId: true, id: true } } },
    });
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    // Prevent self-moderation
    if (chapter.story.authorId === modUser.id) {
      return res.status(403).json({ error: "Không thể duyệt chương của chính mình" });
    }

    const updated = await prisma.chapter.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "approved",
        rejectionReason: null,
        reviewedBy: modUser.id,
        reviewedAt: new Date(),
      },
    });

    // Notify author
    try {
      await prisma.notification.create({
        data: {
          userId: chapter.story.authorId,
          type: "system",
          title: "Chương đã được duyệt ✅",
          message: `Chương ${chapter.number}: "${chapter.title}" của truyện "${chapter.story.title}" đã được duyệt.`,
          link: `/write/${chapter.story.id}`,
        },
      });
    } catch {}

    res.json({ message: "Đã duyệt chương", chapter: updated });
  } catch (error) {
    console.error("Error approving chapter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/mod/chapters/:id/reject — từ chối chương ──
router.put("/chapters/:id/reject", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const modUser = (req as any).modUser;
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "Vui lòng nhập lý do từ chối" });
    }

    const chapter = await prisma.chapter.findUnique({
      where: { id: req.params.id },
      include: { story: { select: { title: true, authorId: true, id: true } } },
    });
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    // Prevent self-moderation
    if (chapter.story.authorId === modUser.id) {
      return res.status(403).json({ error: "Không thể từ chối chương của chính mình" });
    }

    const updated = await prisma.chapter.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "rejected",
        rejectionReason: reason.trim(),
        reviewedBy: modUser.id,
        reviewedAt: new Date(),
      },
    });

    // Notify author
    try {
      await prisma.notification.create({
        data: {
          userId: chapter.story.authorId,
          type: "system",
          title: "Chương bị từ chối ❌",
          message: `Chương ${chapter.number}: "${chapter.title}" của truyện "${chapter.story.title}" không được duyệt. Lý do: ${reason.trim()}`,
          link: `/write/${chapter.story.id}`,
        },
      });
    } catch {}

    res.json({ message: "Đã từ chối chương", chapter: updated });
  } catch (error) {
    console.error("Error rejecting chapter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/mod/chapters/approve-bulk — duyệt hàng loạt ──
router.put("/chapters/approve-bulk", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const modUser = (req as any).modUser;
    const { chapterIds } = req.body;
    if (!Array.isArray(chapterIds) || chapterIds.length === 0) {
      return res.status(400).json({ error: "Danh sách chương trống" });
    }

    // Block self-moderation: filter out chapters authored by the moderator
    const ownChapters = await prisma.chapter.findMany({
      where: { id: { in: chapterIds }, story: { authorId: modUser.id } },
      select: { id: true },
    });
    const ownIds = new Set(ownChapters.map((c: { id: string }) => c.id));
    const safeIds = chapterIds.filter((id: string) => !ownIds.has(id));
    if (safeIds.length === 0) {
      return res.status(403).json({ error: "Không thể tự duyệt chương của chính mình" });
    }

    const result = await prisma.chapter.updateMany({
      where: { id: { in: safeIds }, approvalStatus: "pending" },
      data: {
        approvalStatus: "approved",
        rejectionReason: null,
        reviewedBy: modUser.id,
        reviewedAt: new Date(),
      },
    });

    // Notify authors about bulk-approved chapters
    try {
      const chapters = await prisma.chapter.findMany({
        where: { id: { in: chapterIds } },
        select: {
          number: true,
          title: true,
          story: { select: { id: true, title: true, authorId: true } },
        },
      });
      // Group by author to send one notification per author
      const byAuthor: Record<string, { storyTitle: string; count: number; storyId: string }> = {};
      for (const ch of chapters) {
        const aid = ch.story.authorId;
        if (!byAuthor[aid]) byAuthor[aid] = { storyTitle: ch.story.title, count: 0, storyId: ch.story.id };
        byAuthor[aid].count++;
      }
      for (const [authorId, info] of Object.entries(byAuthor)) {
        await prisma.notification.create({
          data: {
            userId: authorId,
            type: "system",
            title: "Chương đã được duyệt \u2705",
            message: `${info.count} chương của truyện "${info.storyTitle}" đã được duyệt.`,
            link: `/write/${info.storyId}`,
          },
        }).catch(() => {});
      }
    } catch {}

    res.json({ message: `Đã duyệt ${safeIds.length} chương`, approved: result.count });
  } catch (error) {
    console.error("Error bulk approving chapters:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ══════════════════════════════════════════════════
//  COVER IMAGE MODERATION
// ══════════════════════════════════════════════════

// ─── GET /api/mod/covers/stats — thống kê ảnh bìa ──
router.get("/covers/stats", authRequired, modRequired, async (_req: AuthRequest, res: Response) => {
  try {
    const [pending, approved, rejected] = await Promise.all([
      prisma.story.count({ where: { coverApprovalStatus: "pending", coverImage: { not: null } } }),
      prisma.story.count({ where: { coverApprovalStatus: "approved" } }),
      prisma.story.count({ where: { coverApprovalStatus: "rejected" } }),
    ]);
    res.json({ pending, approved, rejected });
  } catch (error) {
    console.error("Error fetching cover stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/mod/covers — danh sách ảnh bìa cần duyệt ──
router.get("/covers", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const status = (req.query.status as string) || "pending";

    const where: any = { coverImage: { not: null } };
    if (status !== "all") where.coverApprovalStatus = status;

    const [stories, total] = await Promise.all([
      prisma.story.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          coverImage: true,
          coverApprovalStatus: true,
          coverRejectionReason: true,
          isAdult: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, email: true, image: true } },
        },
      }),
      prisma.story.count({ where }),
    ]);

    res.json({ stories, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("Error fetching covers:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/mod/covers/:id/approve — duyệt ảnh bìa ──
router.put("/covers/:id/approve", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const story = await prisma.story.findUnique({ where: { id: req.params.id } });
    if (!story) return res.status(404).json({ error: "Story not found" });

    await prisma.story.update({
      where: { id: req.params.id },
      data: { coverApprovalStatus: "approved", coverRejectionReason: null },
    });

    // Notify author
    await prisma.notification.create({
      data: {
        userId: story.authorId,
        type: "system",
        title: "Ảnh bìa đã được duyệt ✅",
        message: `Ảnh bìa truyện "${story.title}" đã được phê duyệt.`,
        link: `/story/${story.slug}`,
      },
    }).catch(() => {});

    res.json({ message: "Đã duyệt ảnh bìa" });
    invalidateCache(`story:${story.slug}`);
  } catch (error) {
    console.error("Error approving cover:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/mod/covers/:id/reject — từ chối ảnh bìa ──
router.put("/covers/:id/reject", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "Vui lòng nhập lý do từ chối" });
    }

    const story = await prisma.story.findUnique({ where: { id: req.params.id } });
    if (!story) return res.status(404).json({ error: "Story not found" });

    await prisma.story.update({
      where: { id: req.params.id },
      data: { coverApprovalStatus: "rejected", coverRejectionReason: reason.trim() },
    });

    // Notify author
    await prisma.notification.create({
      data: {
        userId: story.authorId,
        type: "system",
        title: "Ảnh bìa bị từ chối ❌",
        message: `Ảnh bìa truyện "${story.title}" bị từ chối. Lý do: ${reason.trim()}`,
        link: `/write/${story.id}`,
      },
    }).catch(() => {});

    res.json({ message: "Đã từ chối ảnh bìa" });
    invalidateCache(`story:${story.slug}`);
  } catch (error) {
    console.error("Error rejecting cover:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
