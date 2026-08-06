import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { cached, MEDIUM_TTL } from "../lib/cache";
import { deriveCoverUrl } from "../lib/cover";

const router = Router();

// (deriveCoverUrl is imported from ../lib/cover; see that file for the canonical logic)

// GET /api/ranking — top stories
// B2: Hỗ trợ period=week|month|all, mặc định "all" (backward-compat)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { sort = "views", limit = "20", period = "all" } = req.query;
    const take = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const cacheKey = `ranking:${sort}:${period}:${take}`;

    const stories = await cached(cacheKey, MEDIUM_TTL, async () => {
      let orderBy: any;
      if (sort === "likes") orderBy = { likes: "desc" };
      else if (sort === "rating") orderBy = { averageRating: "desc" };
      else if (sort === "new") orderBy = { createdAt: "desc" };
      else orderBy = { views: "desc" };

      // B2: Nếu period = week hoặc month → lấy view count từ ViewLog trong khoảng thời gian
      if (period === "week" || period === "month") {
        const days = period === "week" ? 7 : 30;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const recentViews = await prisma.viewLog.groupBy({
          by: ["storyId"],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
          orderBy: { _count: { storyId: "desc" } },
          take,
        });

        const storyIds = recentViews.map((v) => v.storyId);
        const storiesData = await prisma.story.findMany({
          where: { id: { in: storyIds }, approvalStatus: "approved" },
          select: {
            id: true,
            title: true,
            slug: true,
            genre: true,
            status: true,
            views: true,
            likes: true,
            averageRating: true,
            ratingCount: true,
            createdAt: true,
            updatedAt: true,
            coverImage: true,
            coverApprovalStatus: true,
            approvalStatus: true,
            author: { select: { id: true, name: true, image: true } },
            _count: { select: { chapters: true } },
          },
        });
        // Map period views vào story
        const viewsMap = new Map(recentViews.map((v) => [v.storyId, v._count._all]));
        const enriched = storiesData
          .map((s) => ({ ...s, periodViews: viewsMap.get(s.id) || 0 }))
          .sort((a, b) => b.periodViews - a.periodViews);
        return enriched;
      }

      return prisma.story.findMany({
        where: { approvalStatus: "approved" },
        orderBy,
        take,
        select: {
          id: true,
          title: true,
          slug: true,
          genre: true,
          status: true,
          views: true,
          likes: true,
          averageRating: true,
          ratingCount: true,
          createdAt: true,
          updatedAt: true,
          coverImage: true,
          coverApprovalStatus: true,
          approvalStatus: true,
          author: { select: { id: true, name: true, image: true } },
          _count: { select: { chapters: true } },
        },
      });
    });

    // Map to include coverUrl and strip raw cover fields
    const mapped = stories.map((s: any) => {
      const { coverImage, coverApprovalStatus, approvalStatus, ...rest } = s;
      return { ...rest, coverUrl: deriveCoverUrl(s) };
    });

    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    res.json(mapped);
  } catch (error) {
    console.error("Error fetching ranking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/ranking/stories/:period — top stories cho trang /rankings
// period = "weekly" | "monthly" | "all-time"
router.get("/stories/:period", async (req: Request, res: Response) => {
  try {
    const period = String(req.params.period || "monthly");
    const take = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20")));
    const cacheKey = `ranking:stories:${period}:${take}`;

    const result = await cached(cacheKey, MEDIUM_TTL, async () => {
      const now = new Date();
      const since = period === "weekly"
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        : period === "monthly"
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : null;

      let periodViewMap = new Map<string, number>();
      let weekStart: string | undefined;
      let year: number | undefined;
      let month: number | undefined;

      if (period === "weekly" || period === "monthly") {
        if (period === "weekly") {
          // 7-day rolling window from ViewLog
          const recentViews = await prisma.viewLog.groupBy({
            by: ["storyId"],
            where: { createdAt: { gte: since! } },
            _count: { _all: true },
            orderBy: { _count: { storyId: "desc" } },
            take: take * 3,
          });
          periodViewMap = new Map(recentViews.map((v) => [v.storyId, v._count._all]));
        } else {
          // 30-day window from MonthlyViewStats + fallback to ViewLog (current month partial)
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          const monthlyRows = await prisma.monthlyViewStats.findMany({
            where: { yearMonth: ym },
          });
          for (const r of monthlyRows) {
            periodViewMap.set(r.storyId, (periodViewMap.get(r.storyId) || 0) + r.views);
          }
          // Add this month's ViewLog too (covers days not yet rolled up)
          const thisMonthViews = await prisma.viewLog.groupBy({
            by: ["storyId"],
            where: { createdAt: { gte: monthStart } },
            _count: { _all: true },
          });
          for (const v of thisMonthViews) {
            periodViewMap.set(v.storyId, (periodViewMap.get(v.storyId) || 0) + v._count._all);
          }
          year = now.getFullYear();
          month = now.getMonth() + 1;
        }
      } else {
        // all-time: use Story.views directly
        year = now.getFullYear();
      }

      const where: any = { approvalStatus: "approved" };
      if (period === "weekly" || period === "monthly") {
        where.id = { in: Array.from(periodViewMap.keys()) };
      }

      const stories = await prisma.story.findMany({
        where,
        take,
        select: {
          id: true,
          title: true,
          slug: true,
          genre: true,
          status: true,
          views: true,
          likes: true,
          averageRating: true,
          ratingCount: true,
          createdAt: true,
          updatedAt: true,
          coverImage: true,
          coverApprovalStatus: true,
          approvalStatus: true,
          author: { select: { id: true, name: true, image: true } },
          _count: { select: { chapters: true } },
        },
      });

      const enriched = stories.map((s) => {
        const periodViews = period === "weekly" || period === "monthly"
          ? periodViewMap.get(s.id) || 0
          : s.views;
        const { coverImage, coverApprovalStatus, approvalStatus, _count, ...rest } = s as any;
        return {
          ...rest,
          chapterCount: _count?.chapters ?? 0,
          coverUrl: deriveCoverUrl(s),
          periodViews,
          weeklyViews: period === "weekly" ? periodViews : null,
          monthlyViews: period === "monthly" ? periodViews : null,
        };
      });

      enriched.sort((a, b) => b.periodViews - a.periodViews);

      // Compute weekStart (Monday of current week)
      if (period === "weekly") {
        const day = now.getDay();
        const diff = (day === 0 ? -6 : 1 - day); // back to Monday
        const monday = new Date(now);
        monday.setDate(now.getDate() + diff);
        weekStart = monday.toISOString().split("T")[0];
      }

      return {
        stories: enriched.slice(0, take),
        year,
        month,
        weekStart,
      };
    });

    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    res.json(result);
  } catch (error) {
    console.error("Error fetching stories ranking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/ranking/authors/:period — top authors
router.get("/authors/:period", async (req: Request, res: Response) => {
  try {
    const period = String(req.params.period || "monthly");
    const take = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20")));
    const cacheKey = `ranking:authors:${period}:${take}`;

    const result = await cached(cacheKey, MEDIUM_TTL, async () => {
      const now = new Date();
      const since = period === "weekly"
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        : period === "monthly"
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : null;

      // Aggregate per-author stats from approved stories
      const storyAgg = await prisma.story.groupBy({
        by: ["authorId"],
        where: { approvalStatus: "approved" },
        _sum: { views: true, likes: true },
        _count: { _all: true },
      });

      // Period-specific earnings per author
      const earningWhere: any = {};
      if (since) earningWhere.createdAt = { gte: since };

      const earningsAgg = await prisma.authorEarning.groupBy({
        by: ["authorId"],
        where: earningWhere,
        _sum: { amount: true },
      });
      const earningsMap = new Map(earningsAgg.map((e) => [e.authorId, e._sum.amount || 0]));

      const authorIds = storyAgg.map((a) => a.authorId);
      const authors = await prisma.user.findMany({
        where: { id: { in: authorIds }, role: "author" },
        select: {
          id: true,
          name: true,
          image: true,
          bio: true,
        },
      });

      const merged = authors.map((a) => {
        const agg = storyAgg.find((s) => s.authorId === a.id);
        return {
          id: a.id,
          name: a.name,
          image: a.image,
          bio: a.bio,
          totalViews: agg?._sum.views || 0,
          totalLikes: agg?._sum.likes || 0,
          storyCount: agg?._count._all || 0,
          totalEarnings: earningsMap.get(a.id) || 0,
          weeklyEarnings: period === "weekly" ? earningsMap.get(a.id) || 0 : undefined,
          monthlyEarnings: period === "monthly" ? earningsMap.get(a.id) || 0 : undefined,
        };
      });

      // Sort: weekly/monthly by earnings, all-time by views
      if (period === "weekly" || period === "monthly") {
        merged.sort((a, b) => (b.weeklyEarnings || b.monthlyEarnings || 0) - (a.weeklyEarnings || a.monthlyEarnings || 0));
      } else {
        merged.sort((a, b) => b.totalViews - a.totalViews);
      }

      const year = now.getFullYear();
      const month = period === "monthly" ? now.getMonth() + 1 : undefined;
      let weekStart: string | undefined;
      if (period === "weekly") {
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diff);
        weekStart = monday.toISOString().split("T")[0];
      }

      return {
        authors: merged.slice(0, take),
        year,
        month,
        weekStart,
      };
    });

    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    res.json(result);
  } catch (error) {
    console.error("Error fetching authors ranking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/ranking/readers/:period — top readers (by coin spend)
router.get("/readers/:period", async (req: Request, res: Response) => {
  try {
    const period = String(req.params.period || "monthly");
    const take = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20")));
    const cacheKey = `ranking:readers:${period}:${take}`;

    const result = await cached(cacheKey, MEDIUM_TTL, async () => {
      const now = new Date();
      const since = period === "weekly"
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        : period === "monthly"
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : null;

      // Use PlatformEarning.grossAmount grouped by fromUserId as proxy for "coins spent"
      // (covers purchases, tips, gifts)
      const earningWhere: any = { fromUserId: { not: null } };
      if (since) earningWhere.createdAt = { gte: since };

      const spendAgg = await prisma.platformEarning.groupBy({
        by: ["fromUserId"],
        where: earningWhere,
        _sum: { grossAmount: true },
        orderBy: { _sum: { grossAmount: "desc" } },
        take: take * 2,
      });

      // Books read = unique storyIds the user has comments/views in
      // (simpler proxy: number of unique stories commented on)
      const userIds = spendAgg.map((s) => s.fromUserId!).filter(Boolean);
      const [users, commentAgg] = await Promise.all([
        prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, image: true },
        }),
        prisma.comment.groupBy({
          by: ["userId", "storyId"],
          where: { userId: { in: userIds } },
        }),
      ]);

      const booksMap = new Map<string, number>();
      for (const c of commentAgg) {
        booksMap.set(c.userId, (booksMap.get(c.userId) || 0) + 1);
      }

      const userMap = new Map(users.map((u) => [u.id, u]));
      const readers = spendAgg
        .filter((s) => userMap.has(s.fromUserId!))
        .map((s) => {
          const u = userMap.get(s.fromUserId!)!;
          return {
            id: u.id,
            name: u.name,
            image: u.image,
            coinsSpent: s._sum.grossAmount || 0,
            booksRead: booksMap.get(u.id) || 0,
          };
        });

      const year = now.getFullYear();
      const month = period === "monthly" ? now.getMonth() + 1 : undefined;
      let weekStart: string | undefined;
      if (period === "weekly") {
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diff);
        weekStart = monday.toISOString().split("T")[0];
      }

      return {
        readers: readers.slice(0, take),
        year,
        month,
        weekStart,
      };
    });

    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    res.json(result);
  } catch (error) {
    console.error("Error fetching readers ranking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
