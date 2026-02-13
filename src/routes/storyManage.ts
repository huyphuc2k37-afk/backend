import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { authRequired, AuthRequest } from "../middleware/auth";
import { compressBase64Image } from "../lib/compressImage";

const router = Router();

// ─── GET /api/manage/stories — danh sách truyện của tác giả ──
router.get("/stories", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user || user.role !== "author") {
      return res.status(403).json({ error: "Bạn chưa đăng ký làm tác giả" });
    }

    const stories = await prisma.story.findMany({
      where: { authorId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        genre: true,
        status: true,
        views: true,
        likes: true,
        isAdult: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { chapters: true, bookmarks: true, comments: true } },
      },
    });

    res.json({ stories, author: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    console.error("Error fetching author stories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/manage/stories/:id — chi tiết 1 truyện để edit ──
router.get("/stories/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(401).json({ error: "Unauthorized" });

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
        views: true,
        likes: true,
        isAdult: true,
        createdAt: true,
        updatedAt: true,
        authorId: true,
        chapters: {
          orderBy: { number: "asc" },
          select: { id: true, title: true, number: true, wordCount: true, isLocked: true, price: true, createdAt: true, updatedAt: true },
        },
        _count: { select: { bookmarks: true, comments: true } },
      },
    });

    if (!story) return res.status(404).json({ error: "Story not found" });
    if (story.authorId !== user.id) return res.status(403).json({ error: "Forbidden" });

    res.json(story);
  } catch (error) {
    console.error("Error fetching story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/manage/stories — tạo truyện mới ──
router.post("/stories", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user || user.role !== "author") {
      return res.status(403).json({ error: "Bạn chưa đăng ký làm tác giả" });
    }

    const { title, slug, description, coverImage, genre, tags, theme, expectedChapters, worldBuilding, characters, plotOutline, targetAudience, postSchedule, isAdult } = req.body;

    if (!title || !slug || !description || !genre) {
      return res.status(400).json({ error: "Thiếu thông tin bắt buộc: tên, slug, mô tả, thể loại" });
    }

    // Compress cover image if provided
    const compressedCover = coverImage ? await compressBase64Image(coverImage) : undefined;

    const story = await prisma.story.create({
      data: {
        title, slug, description, coverImage: compressedCover, genre, tags,
        theme, expectedChapters: expectedChapters ? parseInt(expectedChapters) : null,
        worldBuilding, characters, plotOutline,
        targetAudience, postSchedule, isAdult: isAdult || false,
        authorId: user.id,
      },
    });

    res.status(201).json(story);
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Slug đã tồn tại, hãy chọn tên khác" });
    }
    console.error("Error creating story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/manage/stories/:id — cập nhật truyện ──
router.put("/stories/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const story = await prisma.story.findUnique({ where: { id: req.params.id } });
    if (!story) return res.status(404).json({ error: "Story not found" });
    if (story.authorId !== user.id) return res.status(403).json({ error: "Forbidden" });

    const { title, description, coverImage, genre, tags, status, theme, expectedChapters, worldBuilding, characters, plotOutline, targetAudience, postSchedule, isAdult } = req.body;

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (coverImage !== undefined) data.coverImage = coverImage ? await compressBase64Image(coverImage) : coverImage;
    if (genre !== undefined) data.genre = genre;
    if (tags !== undefined) data.tags = tags;
    if (status !== undefined) data.status = status;
    if (theme !== undefined) data.theme = theme;
    if (expectedChapters !== undefined) data.expectedChapters = expectedChapters ? parseInt(expectedChapters) : null;
    if (worldBuilding !== undefined) data.worldBuilding = worldBuilding;
    if (characters !== undefined) data.characters = characters;
    if (plotOutline !== undefined) data.plotOutline = plotOutline;
    if (targetAudience !== undefined) data.targetAudience = targetAudience;
    if (postSchedule !== undefined) data.postSchedule = postSchedule;
    if (isAdult !== undefined) data.isAdult = isAdult;

    const updated = await prisma.story.update({
      where: { id: req.params.id },
      data,
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/manage/stories/:id — xóa truyện ──
router.delete("/stories/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const story = await prisma.story.findUnique({ where: { id: req.params.id } });
    if (!story) return res.status(404).json({ error: "Story not found" });
    if (story.authorId !== user.id) return res.status(403).json({ error: "Forbidden" });

    await prisma.story.delete({ where: { id: req.params.id } });
    res.json({ message: "Đã xóa truyện" });
  } catch (error) {
    console.error("Error deleting story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/manage/stories/:id/chapters — tạo chương mới ──
router.post("/stories/:storyId/chapters", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const story = await prisma.story.findUnique({ where: { id: req.params.storyId } });
    if (!story) return res.status(404).json({ error: "Story not found" });
    if (story.authorId !== user.id) return res.status(403).json({ error: "Forbidden" });

    const { title, content, authorNote, isLocked, price } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: "Thiếu tiêu đề hoặc nội dung chương" });
    }

    // Auto-calculate word count & next number
    const wordCount = content.replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
    const lastChapter = await prisma.chapter.findFirst({
      where: { storyId: req.params.storyId },
      orderBy: { number: "desc" },
    });
    const nextNumber = (lastChapter?.number || 0) + 1;

    // Validate lock rules: first 10 chapters must be free, price 100-5000
    let finalIsLocked = isLocked || false;
    let finalPrice = price || 0;
    if (nextNumber <= 10) {
      finalIsLocked = false;
      finalPrice = 0;
    } else if (finalIsLocked) {
      if (finalPrice < 100 || finalPrice > 5000) {
        return res.status(400).json({ error: "Giá chương trả phí phải từ 100 đến 5000 xu" });
      }
    }

    const chapter = await prisma.chapter.create({
      data: {
        title,
        number: nextNumber,
        content,
        wordCount,
        authorNote,
        isLocked: finalIsLocked,
        price: finalIsLocked ? finalPrice : 0,
        storyId: req.params.storyId,
      },
    });

    // Update story's updatedAt
    await prisma.story.update({ where: { id: req.params.storyId }, data: { updatedAt: new Date() } });

    res.status(201).json(chapter);
  } catch (error) {
    console.error("Error creating chapter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/manage/chapters/:id — lấy nội dung chương để edit ──
router.get("/chapters/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const chapter = await prisma.chapter.findUnique({
      where: { id: req.params.id },
      include: { story: { select: { id: true, title: true, slug: true, authorId: true } } },
    });

    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    if (chapter.story.authorId !== user.id) return res.status(403).json({ error: "Forbidden" });

    res.json(chapter);
  } catch (error) {
    console.error("Error fetching chapter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/manage/chapters/:id — cập nhật chương ──
router.put("/chapters/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const chapter = await prisma.chapter.findUnique({
      where: { id: req.params.id },
      include: { story: { select: { authorId: true } } },
    });

    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    if (chapter.story.authorId !== user.id) return res.status(403).json({ error: "Forbidden" });

    const { title, content, authorNote, isLocked, price } = req.body;
    const data: any = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) {
      data.content = content;
      data.wordCount = content.replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
    }
    if (authorNote !== undefined) data.authorNote = authorNote;

    // Validate lock rules: first 10 chapters must be free, price 100-5000
    if (isLocked !== undefined) {
      if (isLocked && chapter.number <= 10) {
        return res.status(400).json({ error: "10 chương đầu tiên phải miễn phí" });
      }
      data.isLocked = isLocked;
    }
    if (price !== undefined) {
      const finalLocked = data.isLocked !== undefined ? data.isLocked : chapter.isLocked;
      if (finalLocked && (price < 100 || price > 5000)) {
        return res.status(400).json({ error: "Giá chương trả phí phải từ 100 đến 5000 xu" });
      }
      data.price = price;
    }

    const updated = await prisma.chapter.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (error) {
    console.error("Error updating chapter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/manage/chapters/:id — xóa chương ──
router.delete("/chapters/:id", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const chapter = await prisma.chapter.findUnique({
      where: { id: req.params.id },
      include: { story: { select: { authorId: true } } },
    });

    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    if (chapter.story.authorId !== user.id) return res.status(403).json({ error: "Forbidden" });

    await prisma.chapter.delete({ where: { id: req.params.id } });
    res.json({ message: "Đã xóa chương" });
  } catch (error) {
    console.error("Error deleting chapter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/manage/dashboard — dữ liệu dashboard tác giả (earnings, views chart) ──
router.get("/dashboard", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user || (user.role !== "author" && user.role !== "admin")) {
      return res.status(403).json({ error: "Author only" });
    }

    // Get author's stories
    const stories = await prisma.story.findMany({
      where: { authorId: user.id },
      select: { id: true, views: true, likes: true, title: true },
    });

    const totalViews = stories.reduce((s, st) => s + st.views, 0);
    const totalLikes = stories.reduce((s, st) => s + st.likes, 0);

    // Today's earnings
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayEarnings = await prisma.authorEarning.aggregate({
      where: { authorId: user.id, createdAt: { gte: startOfDay } },
      _sum: { amount: true },
    });

    // This month earnings  
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthEarnings = await prisma.authorEarning.aggregate({
      where: { authorId: user.id, createdAt: { gte: startOfMonth } },
      _sum: { amount: true },
    });

    // 14-day earnings chart (real data)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const recentEarnings = await prisma.authorEarning.findMany({
      where: { authorId: user.id, createdAt: { gte: fourteenDaysAgo } },
      select: { amount: true, createdAt: true },
    });

    const dailyMap: Record<string, number> = {};
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.now() - (13 - i) * 24 * 60 * 60 * 1000);
      dailyMap[d.toISOString().slice(0, 10)] = 0;
    }
    for (const e of recentEarnings) {
      const key = e.createdAt.toISOString().slice(0, 10);
      if (dailyMap[key] !== undefined) dailyMap[key] += e.amount;
    }
    const earningsChart = Object.entries(dailyMap).map(([date, value]) => ({
      day: new Date(date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }),
      value,
    }));

    res.json({
      balance: user.coinBalance,
      totalViews,
      totalLikes,
      todayEarnings: todayEarnings._sum.amount || 0,
      monthEarnings: monthEarnings._sum.amount || 0,
      earningsChart,
    });
  } catch (error) {
    console.error("Error fetching dashboard:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
