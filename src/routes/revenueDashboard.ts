import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ─── Admin middleware ─────────────────────────────────────────────────────────
async function adminRequired(req: AuthRequest, res: Response, next: Function) {
  const user = await prisma.user.findUnique({
    where: { email: req.user!.email },
  });
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  req.adminUser = user;
  next();
}

// ─── GET /api/admin/revenue/daily — Doanh thu theo ngày ───────────────────
router.get("/daily", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Revenue from approved deposits (cash-in)
    const depositsByDay = await prisma.$queryRaw<{ date: string; amount: bigint }[]>`
      SELECT 
        TO_CHAR("createdAt", 'YYYY-MM-DD') as date,
        COALESCE(SUM(amount), 0)::bigint as amount
      FROM "Deposit"
      WHERE status = 'approved'
        AND "createdAt" >= ${startDate}
      GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD')
      ORDER BY date ASC
    `;

    // Revenue from platform earnings (gross content spending)
    const earningsByDay = await prisma.$queryRaw<{ date: string; purchases: bigint; tips: bigint; views: bigint; admin: bigint }[]>`
      SELECT 
        TO_CHAR("createdAt", 'YYYY-MM-DD') as date,
        COALESCE(SUM(CASE WHEN type = 'purchase' THEN "grossAmount" ELSE 0 END), 0)::bigint as purchases,
        COALESCE(SUM(CASE WHEN type = 'tip' THEN "grossAmount" ELSE 0 END), 0)::bigint as tips,
        0::bigint as views,
        0::bigint as admin
      FROM "PlatformEarning"
      WHERE "createdAt" >= ${startDate}
      GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD')
      ORDER BY date ASC
    `;

    // Build complete date range
    const dateMap: Record<string, { date: string; deposits: number; purchases: number; tips: number; views: number; admin: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dateMap[key] = { date: key, deposits: 0, purchases: 0, tips: 0, views: 0, admin: 0 };
    }

    for (const d of depositsByDay) {
      if (dateMap[d.date]) dateMap[d.date].deposits = Number(d.amount);
    }
    for (const e of earningsByDay) {
      if (dateMap[e.date]) {
        dateMap[e.date].purchases = Number(e.purchases);
        dateMap[e.date].tips = Number(e.tips);
      }
    }

    const data = Object.values(dateMap).map((d) => ({
      ...d,
      total: d.deposits + d.purchases + d.tips,
      label: new Date(d.date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }),
    }));

    // Summary
    const totalDeposits = depositsByDay.reduce((sum, d) => sum + Number(d.amount), 0);
    const totalPurchases = earningsByDay.reduce((sum, e) => sum + Number(e.purchases), 0);
    const totalTips = earningsByDay.reduce((sum, e) => sum + Number(e.tips), 0);

    res.json({
      data,
      summary: {
        totalDeposits,
        totalPurchases,
        totalTips,
        totalRevenue: totalDeposits + totalPurchases + totalTips,
      },
    });
  } catch (error) {
    console.error("Error fetching daily revenue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/revenue/weekly — Doanh thu theo tuần ──────────────────
router.get("/weekly", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const weeks = parseInt(req.query.weeks as string) || 12;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - weeks * 7);
    startDate.setHours(0, 0, 0, 0);

    // Revenue from approved deposits by week
    const depositsByWeek = await prisma.$queryRaw<{ week: string; year: number; amount: bigint }[]>`
      SELECT 
        TO_CHAR(DATE_TRUNC('week', "createdAt"), 'IYYY-IW') as week,
        EXTRACT(YEAR FROM DATE_TRUNC('week', "createdAt"))::int as year,
        COALESCE(SUM(amount), 0)::bigint as amount
      FROM "Deposit"
      WHERE status = 'approved'
        AND "createdAt" >= ${startDate}
      GROUP BY TO_CHAR(DATE_TRUNC('week', "createdAt"), 'IYYY-IW'), EXTRACT(YEAR FROM DATE_TRUNC('week', "createdAt"))
      ORDER BY year ASC, week ASC
    `;

    // Revenue from platform earnings by week
    const earningsByWeek = await prisma.$queryRaw<{ week: string; year: number; purchases: bigint; tips: bigint }[]>`
      SELECT 
        TO_CHAR(DATE_TRUNC('week', "createdAt"), 'IYYY-IW') as week,
        EXTRACT(YEAR FROM DATE_TRUNC('week', "createdAt"))::int as year,
        COALESCE(SUM(CASE WHEN type = 'purchase' THEN "grossAmount" ELSE 0 END), 0)::bigint as purchases,
        COALESCE(SUM(CASE WHEN type = 'tip' THEN "grossAmount" ELSE 0 END), 0)::bigint as tips
      FROM "PlatformEarning"
      WHERE "createdAt" >= ${startDate}
      GROUP BY TO_CHAR(DATE_TRUNC('week', "createdAt"), 'IYYY-IW'), EXTRACT(YEAR FROM DATE_TRUNC('week', "createdAt"))
      ORDER BY year ASC, week ASC
    `;

    // Build complete week range
    const weekMap: Record<string, { week: string; year: number; deposits: number; purchases: number; tips: number }> = {};
    for (let i = 0; i < weeks; i++) {
      const d = new Date(Date.now() - (weeks - 1 - i) * 7 * 24 * 60 * 60 * 1000);
      const year = d.getFullYear();
      const firstDayOfYear = new Date(year, 0, 1);
      const daysOffset = (d.getDay() + 6) % 7;
      const weekNum = Math.ceil((d.getTime() - firstDayOfYear.getTime() + daysOffset * 24 * 60 * 60 * 1000) / (7 * 24 * 60 * 60 * 1000));
      const key = `${year}-${String(weekNum).padStart(2, "0")}`;
      weekMap[key] = { week: key, year, deposits: 0, purchases: 0, tips: 0 };
    }

    for (const d of depositsByWeek) {
      const key = d.week;
      if (weekMap[key]) weekMap[key].deposits = Number(d.amount);
    }
    for (const e of earningsByWeek) {
      const key = e.week;
      if (weekMap[key]) {
        weekMap[key].purchases = Number(e.purchases);
        weekMap[key].tips = Number(e.tips);
      }
    }

    const data = Object.values(weekMap).map((w) => ({
      ...w,
      total: w.deposits + w.purchases + w.tips,
      label: `Tuần ${w.week}`,
    }));

    const totalDeposits = depositsByWeek.reduce((sum, d) => sum + Number(d.amount), 0);
    const totalPurchases = earningsByWeek.reduce((sum, e) => sum + Number(e.purchases), 0);
    const totalTips = earningsByWeek.reduce((sum, e) => sum + Number(e.tips), 0);

    res.json({
      data,
      summary: {
        totalDeposits,
        totalPurchases,
        totalTips,
        totalRevenue: totalDeposits + totalPurchases + totalTips,
      },
    });
  } catch (error) {
    console.error("Error fetching weekly revenue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/revenue/monthly — Doanh thu theo tháng ─────────────────
router.get("/monthly", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const months = parseInt(req.query.months as string) || 12;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    startDate.setHours(0, 0, 0, 0);

    // Revenue from approved deposits by month
    const depositsByMonth = await prisma.$queryRaw<{ month: string; amount: bigint }[]>`
      SELECT 
        TO_CHAR("createdAt", 'YYYY-MM') as month,
        COALESCE(SUM(amount), 0)::bigint as amount
      FROM "Deposit"
      WHERE status = 'approved'
        AND "createdAt" >= ${startDate}
      GROUP BY TO_CHAR("createdAt", 'YYYY-MM')
      ORDER BY month ASC
    `;

    // Revenue from platform earnings by month
    const earningsByMonth = await prisma.$queryRaw<{ month: string; purchases: bigint; tips: bigint }[]>`
      SELECT 
        TO_CHAR("createdAt", 'YYYY-MM') as month,
        COALESCE(SUM(CASE WHEN type = 'purchase' THEN "grossAmount" ELSE 0 END), 0)::bigint as purchases,
        COALESCE(SUM(CASE WHEN type = 'tip' THEN "grossAmount" ELSE 0 END), 0)::bigint as tips
      FROM "PlatformEarning"
      WHERE "createdAt" >= ${startDate}
      GROUP BY TO_CHAR("createdAt", 'YYYY-MM')
      ORDER BY month ASC
    `;

    // Build complete month range
    const monthMap: Record<string, { month: string; deposits: number; purchases: number; tips: number }> = {};
    for (let i = 0; i < months; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - (months - 1 - i));
      const key = d.toISOString().slice(0, 7);
      monthMap[key] = { month: key, deposits: 0, purchases: 0, tips: 0 };
    }

    for (const d of depositsByMonth) {
      if (monthMap[d.month]) monthMap[d.month].deposits = Number(d.amount);
    }
    for (const e of earningsByMonth) {
      if (monthMap[e.month]) {
        monthMap[e.month].purchases = Number(e.purchases);
        monthMap[e.month].tips = Number(e.tips);
      }
    }

    const data = Object.values(monthMap).map((m) => {
      const [year, month] = m.month.split("-");
      const date = new Date(parseInt(year), parseInt(month) - 1);
      return {
        ...m,
        total: m.deposits + m.purchases + m.tips,
        label: date.toLocaleDateString("vi-VN", { month: "long", year: "numeric" }),
      };
    });

    const totalDeposits = depositsByMonth.reduce((sum, d) => sum + Number(d.amount), 0);
    const totalPurchases = earningsByMonth.reduce((sum, e) => sum + Number(e.purchases), 0);
    const totalTips = earningsByMonth.reduce((sum, e) => sum + Number(e.tips), 0);

    res.json({
      data,
      summary: {
        totalDeposits,
        totalPurchases,
        totalTips,
        totalRevenue: totalDeposits + totalPurchases + totalTips,
      },
    });
  } catch (error) {
    console.error("Error fetching monthly revenue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/revenue/yearly — Doanh thu theo năm ───────────────────
router.get("/yearly", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const years = parseInt(req.query.years as string) || 5;
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    startDate.setHours(0, 0, 0, 0);

    // Revenue from approved deposits by year
    const depositsByYear = await prisma.$queryRaw<{ year: number; amount: bigint }[]>`
      SELECT 
        EXTRACT(YEAR FROM "createdAt")::int as year,
        COALESCE(SUM(amount), 0)::bigint as amount
      FROM "Deposit"
      WHERE status = 'approved'
        AND "createdAt" >= ${startDate}
      GROUP BY EXTRACT(YEAR FROM "createdAt")
      ORDER BY year ASC
    `;

    // Revenue from platform earnings by year
    const earningsByYear = await prisma.$queryRaw<{ year: number; purchases: bigint; tips: bigint }[]>`
      SELECT 
        EXTRACT(YEAR FROM "createdAt")::int as year,
        COALESCE(SUM(CASE WHEN type = 'purchase' THEN "grossAmount" ELSE 0 END), 0)::bigint as purchases,
        COALESCE(SUM(CASE WHEN type = 'tip' THEN "grossAmount" ELSE 0 END), 0)::bigint as tips
      FROM "PlatformEarning"
      WHERE "createdAt" >= ${startDate}
      GROUP BY EXTRACT(YEAR FROM "createdAt")
      ORDER BY year ASC
    `;

    // Build complete year range
    const yearMap: Record<number, { year: number; deposits: number; purchases: number; tips: number }> = {};
    const currentYear = new Date().getFullYear();
    for (let i = 0; i < years; i++) {
      const year = currentYear - (years - 1 - i);
      yearMap[year] = { year, deposits: 0, purchases: 0, tips: 0 };
    }

    for (const d of depositsByYear) {
      if (yearMap[d.year]) yearMap[d.year].deposits = Number(d.amount);
    }
    for (const e of earningsByYear) {
      if (yearMap[e.year]) {
        yearMap[e.year].purchases = Number(e.purchases);
        yearMap[e.year].tips = Number(e.tips);
      }
    }

    const data = Object.values(yearMap).map((y) => ({
      ...y,
      total: y.deposits + y.purchases + y.tips,
      label: y.year.toString(),
    }));

    const totalDeposits = depositsByYear.reduce((sum, d) => sum + Number(d.amount), 0);
    const totalPurchases = earningsByYear.reduce((sum, e) => sum + Number(e.purchases), 0);
    const totalTips = earningsByYear.reduce((sum, e) => sum + Number(e.tips), 0);

    res.json({
      data,
      summary: {
        totalDeposits,
        totalPurchases,
        totalTips,
        totalRevenue: totalDeposits + totalPurchases + totalTips,
      },
    });
  } catch (error) {
    console.error("Error fetching yearly revenue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/revenue/by-type — Phân tích doanh thu theo loại ────────
router.get("/by-type", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const period = (req.query.period as string) || "all";
    let startDate: Date | undefined;

    if (period === "30d") {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === "90d") {
      startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    } else if (period === "365d") {
      startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    }

    const dateFilter = startDate ? { createdAt: { gte: startDate } } : {};

    // Purchase revenue
    const purchaseRevenue = await prisma.platformEarning.aggregate({
      where: { type: "purchase", ...dateFilter },
      _sum: { grossAmount: true, authorAmount: true, platformAmount: true, taxAmount: true },
      _count: true,
    });

    // Tip revenue
    const tipRevenue = await prisma.platformEarning.aggregate({
      where: { type: "tip", ...dateFilter },
      _sum: { grossAmount: true, authorAmount: true, platformAmount: true, taxAmount: true },
      _count: true,
    });

    // View earnings (from authorEarnings)
    const viewEarnings = await prisma.authorEarning.aggregate({
      where: { type: "view", ...dateFilter },
      _sum: { amount: true },
      _count: true,
    });

    // Admin credits
    const adminCredits = await prisma.authorEarning.aggregate({
      where: { type: "admin", ...dateFilter },
      _sum: { amount: true },
      _count: true,
    });

    // Total deposits (cash-in)
    const totalDeposits = await prisma.deposit.aggregate({
      where: { status: "approved", ...dateFilter },
      _sum: { amount: true, coins: true },
      _count: true,
    });

    // Referral earnings
    const referralEarnings = await prisma.referralEarning.aggregate({
      where: dateFilter,
      _sum: { amount: true },
      _count: true,
    });

    // Calculate totals
    const purchasesGross = Number(purchaseRevenue._sum.grossAmount) || 0;
    const tipsGross = Number(tipRevenue._sum.grossAmount) || 0;
    const totalContentSpending = purchasesGross + tipsGross;

    res.json({
      byType: [
        {
          type: "purchases",
          label: "Mua chương",
          gross: purchasesGross,
          authorAmount: Number(purchaseRevenue._sum.authorAmount) || 0,
          platformAmount: Number(purchaseRevenue._sum.platformAmount) || 0,
          taxAmount: Number(purchaseRevenue._sum.taxAmount) || 0,
          count: purchaseRevenue._count || 0,
          percentage: totalContentSpending > 0 ? Math.round((purchasesGross / totalContentSpending) * 100) : 0,
        },
        {
          type: "tips",
          label: "Tặng tác giả",
          gross: tipsGross,
          authorAmount: Number(tipRevenue._sum.authorAmount) || 0,
          platformAmount: Number(tipRevenue._sum.platformAmount) || 0,
          taxAmount: Number(tipRevenue._sum.taxAmount) || 0,
          count: tipRevenue._count || 0,
          percentage: totalContentSpending > 0 ? Math.round((tipsGross / totalContentSpending) * 100) : 0,
        },
        {
          type: "views",
          label: "Lượt xem",
          gross: Number(viewEarnings._sum.amount) || 0,
          authorAmount: Number(viewEarnings._sum.amount) || 0,
          platformAmount: 0,
          taxAmount: 0,
          count: viewEarnings._count || 0,
          percentage: 0,
        },
        {
          type: "admin",
          label: "Admin cộng xu",
          gross: Number(adminCredits._sum.amount) || 0,
          authorAmount: Number(adminCredits._sum.amount) || 0,
          platformAmount: 0,
          taxAmount: 0,
          count: adminCredits._count || 0,
          percentage: 0,
        },
      ],
      summary: {
        totalDepositsAmount: Number(totalDeposits._sum.amount) || 0,
        totalDepositsCoins: Number(totalDeposits._sum.coins) || 0,
        depositCount: totalDeposits._count || 0,
        totalContentSpending,
        totalAuthorEarnings: (Number(purchaseRevenue._sum.authorAmount) || 0) + (Number(tipRevenue._sum.authorAmount) || 0) + (Number(viewEarnings._sum.amount) || 0) + (Number(adminCredits._sum.amount) || 0),
        totalPlatformRevenue: (Number(purchaseRevenue._sum.platformAmount) || 0) + (Number(tipRevenue._sum.platformAmount) || 0),
        totalTax: (Number(purchaseRevenue._sum.taxAmount) || 0) + (Number(tipRevenue._sum.taxAmount) || 0),
        referralEarnings: Number(referralEarnings._sum.amount) || 0,
        period: period === "all" ? "Tất cả thời gian" : period,
      },
    });
  } catch (error) {
    console.error("Error fetching revenue by type:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/revenue/authors — Thu nhập tác giả ─────────────────────
router.get("/authors", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const sortBy = (req.query.sortBy as string) || "totalEarnings";
    const period = (req.query.period as string) || "all";

    let startDate: Date | undefined;
    if (period === "30d") {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === "90d") {
      startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    } else if (period === "365d") {
      startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    }

    const dateFilter = startDate ? { createdAt: { gte: startDate } } : {};

    // Get authors with their earnings
    const authors = await prisma.user.findMany({
      where: { role: "author" },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
        _count: { select: { stories: true } },
        earnings: {
          where: dateFilter,
          select: {
            type: true,
            amount: true,
            createdAt: true,
          },
        },
      },
    });

    // Process author data
    const authorData = authors.map((author) => {
      const purchases = author.earnings.filter((e) => e.type === "purchase").reduce((sum, e) => sum + e.amount, 0);
      const tips = author.earnings.filter((e) => e.type === "tip").reduce((sum, e) => sum + e.amount, 0);
      const views = author.earnings.filter((e) => e.type === "view").reduce((sum, e) => sum + e.amount, 0);
      const admin = author.earnings.filter((e) => e.type === "admin").reduce((sum, e) => sum + e.amount, 0);
      const totalEarnings = purchases + tips + views + admin;

      return {
        id: author.id,
        name: author.name,
        email: author.email,
        image: author.image,
        storyCount: author._count.stories,
        joinedAt: author.createdAt,
        earnings: {
          purchases,
          tips,
          views,
          admin,
          total: totalEarnings,
        },
      };
    });

    // Sort
    let sortedAuthors = authorData;
    if (sortBy === "purchases") {
      sortedAuthors = authorData.sort((a, b) => b.earnings.purchases - a.earnings.purchases);
    } else if (sortBy === "tips") {
      sortedAuthors = authorData.sort((a, b) => b.earnings.tips - a.earnings.tips);
    } else if (sortBy === "stories") {
      sortedAuthors = authorData.sort((a, b) => b.storyCount - a.storyCount);
    } else {
      sortedAuthors = authorData.sort((a, b) => b.earnings.total - a.earnings.total);
    }

    const total = sortedAuthors.length;
    const paginatedAuthors = sortedAuthors.slice((page - 1) * limit, page * limit);

    res.json({
      authors: paginatedAuthors,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching author earnings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/revenue/export — Xuất dữ liệu CSV ──────────────────────
router.get("/export", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const format = (req.query.format as string) || "csv";
    const period = (req.query.period as string) || "30d";

    let startDate: Date;
    switch (period) {
      case "7d":
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "365d":
        startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get deposits
    const deposits = await prisma.deposit.findMany({
      where: { status: "approved", createdAt: { gte: startDate } },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });

    // Get platform earnings
    const earnings = await prisma.platformEarning.findMany({
      where: { createdAt: { gte: startDate } },
      orderBy: { createdAt: "desc" },
    });

    // Get author earnings
    const authorEarnings = await prisma.authorEarning.findMany({
      where: { createdAt: { gte: startDate } },
      include: { author: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });

    if (format === "json") {
      res.json({
        period,
        startDate: startDate.toISOString(),
        exports: {
          deposits: deposits.map((d) => ({
            date: d.createdAt.toISOString(),
            user: d.user.name,
            email: d.user.email,
            amount: d.amount,
            coins: d.coins,
            method: d.method,
            transferCode: d.transferCode,
          })),
          earnings: earnings.map((e) => ({
            date: e.createdAt.toISOString(),
            type: e.type,
            grossAmount: e.grossAmount,
            authorAmount: e.authorAmount,
            platformAmount: e.platformAmount,
            taxAmount: e.taxAmount,
          })),
          authorEarnings: authorEarnings.map((ae) => ({
            date: ae.createdAt.toISOString(),
            author: ae.author.name,
            email: ae.author.email,
            type: ae.type,
            amount: ae.amount,
            storyTitle: ae.storyTitle,
            chapterTitle: ae.chapterTitle,
          })),
        },
      });
      return;
    }

    // CSV format
    const escapeCSV = (value: string | number | null | undefined): string => {
      const str = String(value ?? "");
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Summary section
    const totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0);
    const totalCoins = deposits.reduce((sum, d) => sum + d.coins, 0);
    const totalPurchases = earnings.filter((e) => e.type === "purchase").reduce((sum, e) => sum + e.grossAmount, 0);
    const totalTips = earnings.filter((e) => e.type === "tip").reduce((sum, e) => sum + e.grossAmount, 0);
    const totalAuthorPaid = earnings.reduce((sum, e) => sum + e.authorAmount, 0);
    const totalPlatformRevenue = earnings.reduce((sum, e) => sum + e.platformAmount, 0);
    const totalTax = earnings.reduce((sum, e) => sum + e.taxAmount, 0);

    let csv = "";

    // Summary
    csv += "=== REVENUE SUMMARY ===\n";
    csv += `Period,${period}\n`;
    csv += `Start Date,${startDate.toISOString().split("T")[0]}\n`;
    csv += `Export Date,${new Date().toISOString().split("T")[0]}\n\n`;

    csv += "Metric,Value\n";
    csv += `Total Deposits (VND),${totalDeposits}\n`;
    csv += `Total Coins Deposited,${totalCoins}\n`;
    csv += `Total Purchase Revenue,${totalPurchases}\n`;
    csv += `Total Tip Revenue,${totalTips}\n`;
    csv += `Total Content Spending,${totalPurchases + totalTips}\n`;
    csv += `Author Payments,${totalAuthorPaid}\n`;
    csv += `Platform Revenue,${totalPlatformRevenue}\n`;
    csv += `Tax Collected,${totalTax}\n`;
    csv += `Number of Deposits,${deposits.length}\n\n`;

    // Deposits
    csv += "=== DEPOSITS ===\n";
    csv += "Date,User,Email,Amount (VND),Coins,Method,Transfer Code\n";
    for (const d of deposits) {
      csv += `${d.createdAt.toISOString().split("T")[0]},${escapeCSV(d.user.name)},${escapeCSV(d.user.email)},${d.amount},${d.coins},${escapeCSV(d.method)},${escapeCSV(d.transferCode)}\n`;
    }
    csv += "\n";

    // Platform Earnings
    csv += "=== PLATFORM EARNINGS ===\n";
    csv += "Date,Type,Gross Amount,Author Amount,Platform Amount,Tax Amount\n";
    for (const e of earnings) {
      csv += `${e.createdAt.toISOString().split("T")[0]},${e.type},${e.grossAmount},${e.authorAmount},${e.platformAmount},${e.taxAmount}\n`;
    }
    csv += "\n";

    // Author Earnings
    csv += "=== AUTHOR EARNINGS ===\n";
    csv += "Date,Author,Email,Type,Amount,Story,Chapter\n";
    for (const ae of authorEarnings) {
      csv += `${ae.createdAt.toISOString().split("T")[0]},${escapeCSV(ae.author.name)},${escapeCSV(ae.author.email)},${ae.type},${ae.amount},${escapeCSV(ae.storyTitle)},${escapeCSV(ae.chapterTitle)}\n`;
    }

    const filename = `revenue-report-${period}-${new Date().toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\ufeff" + csv); // BOM for Excel UTF-8 compatibility
  } catch (error) {
    console.error("Error exporting revenue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/revenue/overview — Tổng quan doanh thu ────────────────
router.get("/overview", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    // Current month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Last month
    const startOfLastMonth = new Date(startOfMonth);
    startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);

    // This week
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    // Today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Queries
    const [
      thisMonthDeposits,
      lastMonthDeposits,
      thisWeekDeposits,
      todayDeposits,
      thisMonthEarnings,
      lastMonthEarnings,
      allTimeStats,
      pendingCounts,
    ] = await Promise.all([
      // This month deposits
      prisma.deposit.aggregate({
        where: { status: "approved", createdAt: { gte: startOfMonth } },
        _sum: { amount: true, coins: true },
        _count: true,
      }),
      // Last month deposits
      prisma.deposit.aggregate({
        where: { status: "approved", createdAt: { gte: startOfLastMonth, lt: startOfMonth } },
        _sum: { amount: true, coins: true },
        _count: true,
      }),
      // This week deposits
      prisma.deposit.aggregate({
        where: { status: "approved", createdAt: { gte: startOfWeek } },
        _sum: { amount: true, coins: true },
        _count: true,
      }),
      // Today deposits
      prisma.deposit.aggregate({
        where: { status: "approved", createdAt: { gte: startOfToday } },
        _sum: { amount: true, coins: true },
        _count: true,
      }),
      // This month earnings
      prisma.platformEarning.aggregate({
        where: { createdAt: { gte: startOfMonth } },
        _sum: { grossAmount: true, authorAmount: true, platformAmount: true, taxAmount: true },
      }),
      // Last month earnings
      prisma.platformEarning.aggregate({
        where: { createdAt: { gte: startOfLastMonth, lt: startOfMonth } },
        _sum: { grossAmount: true, authorAmount: true, platformAmount: true, taxAmount: true },
      }),
      // All time stats
      prisma.platformEarning.aggregate({
        _sum: { grossAmount: true, authorAmount: true, platformAmount: true, taxAmount: true },
      }),
      // Pending counts
      Promise.all([
        prisma.deposit.count({ where: { status: "pending" } }),
        prisma.withdrawal.count({ where: { status: "pending" } }),
      ]),
    ]);

    const thisMonthRevenue = Number(thisMonthDeposits._sum.amount || 0);
    const lastMonthRevenue = Number(lastMonthDeposits._sum.amount || 0);
    const thisMonthEarningsGross = Number(thisMonthEarnings._sum.grossAmount || 0);
    const lastMonthEarningsGross = Number(lastMonthEarnings._sum.grossAmount || 0);

    // Calculate growth
    const revenueGrowth = lastMonthRevenue > 0
      ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : thisMonthRevenue > 0 ? 100 : 0;

    const earningsGrowth = lastMonthEarningsGross > 0
      ? Math.round(((thisMonthEarningsGross - lastMonthEarningsGross) / lastMonthEarningsGross) * 100)
      : thisMonthEarningsGross > 0 ? 100 : 0;

    res.json({
      today: {
        deposits: Number(todayDeposits._sum.amount || 0),
        coins: Number(todayDeposits._sum.coins || 0),
        count: todayDeposits._count || 0,
      },
      thisWeek: {
        deposits: Number(thisWeekDeposits._sum.amount || 0),
        coins: Number(thisWeekDeposits._sum.coins || 0),
        count: thisWeekDeposits._count || 0,
      },
      thisMonth: {
        deposits: thisMonthRevenue,
        coins: Number(thisMonthDeposits._sum.coins || 0),
        count: thisMonthDeposits._count || 0,
        contentSpending: thisMonthEarningsGross,
        authorPayments: Number(thisMonthEarnings._sum.authorAmount || 0),
        platformRevenue: Number(thisMonthEarnings._sum.platformAmount || 0),
        tax: Number(thisMonthEarnings._sum.taxAmount || 0),
      },
      lastMonth: {
        deposits: lastMonthRevenue,
        contentSpending: lastMonthEarningsGross,
      },
      allTime: {
        contentSpending: Number(allTimeStats._sum.grossAmount || 0),
        authorPayments: Number(allTimeStats._sum.authorAmount || 0),
        platformRevenue: Number(allTimeStats._sum.platformAmount || 0),
        tax: Number(allTimeStats._sum.taxAmount || 0),
      },
      pending: {
        deposits: pendingCounts[0],
        withdrawals: pendingCounts[1],
      },
      growth: {
        revenue: revenueGrowth,
        earnings: earningsGrowth,
      },
    });
  } catch (error) {
    console.error("Error fetching revenue overview:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
