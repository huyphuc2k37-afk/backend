import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET /api/sitemap
// Returns lightweight URL data for building sitemap.xml on the frontend.
// By default, excludes locked chapters to avoid indexing paywalled/thin pages.
router.get("/", async (req: Request, res: Response) => {
  try {
    const includeLocked =
      req.query.includeLocked === "1" || req.query.includeLocked === "true";

    const [stories, chapters] = await Promise.all([
      prisma.story.findMany({
        where: { approvalStatus: "approved" },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.chapter.findMany({
        where: {
          ...(includeLocked ? {} : { isLocked: false }),
          story: { approvalStatus: "approved" },
        },
        select: {
          id: true,
          updatedAt: true,
          story: { select: { slug: true } },
        },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
    res.json({
      stories: stories.map((s) => ({ slug: s.slug, updatedAt: s.updatedAt })),
      chapters: chapters.map((c) => ({
        storySlug: c.story.slug,
        chapterId: c.id,
        updatedAt: c.updatedAt,
      })),
    });
  } catch (error) {
    console.error("Error generating sitemap data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
