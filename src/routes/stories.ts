import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { compressBase64Image } from "../lib/compressImage";
import { cached, SHORT_TTL } from "../lib/cache";
import { downloadCoverByPublicUrl } from "../lib/supabaseStorage";

const router = Router();

/** Derive a direct cover URL from a Story record (null if none or rejected) */
function deriveCoverUrl(story: { coverImage?: string | null; coverApprovalStatus?: string; approvalStatus?: string }): string | null {
  if (!story.coverImage) return null;
  // Block rejected covers
  if (story.coverApprovalStatus === "rejected") return null;
  // For non-approved stories, cover must be explicitly approved
  if (story.approvalStatus !== "approved" && story.coverApprovalStatus !== "approved") return null;
  // Always go through /api/stories/:id/cover for resilience (CDN/public URL can fail).
  return null;
}

// GET /api/stories — list stories with optional filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      genre, category, tags: tagSlugs,
      status, search, sort = "updatedAt",
      page = "1", limit = "20",
      is_paid, is_adult,
      featured,
      story_origin,
    } = req.query;

    const where: any = { approvalStatus: "approved" };
    if (featured === "true") where.featuredSlot = { not: null };
    if (story_origin === "original" || story_origin === "translated") {
      where.storyOrigin = story_origin;
    }
    if (genre) {
      // Match stories where the genre field contains the name (exact or as part of comma-separated list)
      // OR there's a matching StoryTag (type=genre) with that name.
      const genreName = genre as string;
      where.OR = [
        { genre: { contains: genreName, mode: "insensitive" } },
        { storyTags: { some: { tag: { name: { equals: genreName, mode: "insensitive" }, type: "genre" } } } },
      ];
    }
    if (category) {
      where.category = { slug: category as string };
    }
    if (tagSlugs) {
      const slugs = (tagSlugs as string).split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10);
      if (slugs.length > 0) {
        // Always use AND to safely combine with any existing filters (genre OR, etc.)
        where.AND = [...(where.AND || []), { storyTags: { some: { tag: { slug: { in: slugs } } } } }];
      }
    }
    if (status) where.status = status as string;
    if (is_paid === "true") where.chapters = { some: { isLocked: true } };
    if (is_paid === "false") where.chapters = { none: { isLocked: true } };
    if (is_adult === "true") where.isAdult = true;
    if (is_adult === "false") where.isAdult = false;
    if (search) {
      const searchOR = [
        { title: { contains: search as string, mode: "insensitive" } },
        { originalTitle: { contains: search as string, mode: "insensitive" } },
        { originalAuthor: { contains: search as string, mode: "insensitive" } },
        { translatorName: { contains: search as string, mode: "insensitive" } },
        { description: { contains: search as string, mode: "insensitive" } },
        { author: { name: { contains: search as string, mode: "insensitive" } } },
      ];
      // If genre already used where.OR, wrap search in AND to avoid overwriting
      if (where.OR) {
        where.AND = [...(where.AND || []), { OR: searchOR }];
      } else {
        where.OR = searchOR;
      }
    }

    const orderBy: any[] = [];
    if (featured === "true") {
      orderBy.push({ featuredSlot: "asc" });
    }
    if (sort === "views") orderBy.push({ views: "desc" });
    else if (sort === "likes" || sort === "popular") orderBy.push({ likes: "desc" });
    else if (sort === "new") orderBy.push({ createdAt: "desc" });
    else orderBy.push({ updatedAt: "desc" });

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const cacheKey = `stories:${genre || ""}:${category || ""}:${tagSlugs || ""}:${status || ""}:${search || ""}:${sort}:${pageNum}:${limitNum}:${is_paid || ""}:${is_adult || ""}:${featured || ""}:${story_origin || ""}`;

    const result = await cached(cacheKey, SHORT_TTL, async () => {
      const [stories, total] = await Promise.all([
        prisma.story.findMany({
          where,
          orderBy,
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
          select: {
            id: true,
            title: true,
            slug: true,
            description: true,
            featuredSlot: true,
            genre: true,
            tags: true,
            storyOrigin: true,
            originalTitle: true,
            originalAuthor: true,
            originalLanguage: true,
            translatorName: true,
            translationGroup: true,
            sourceName: true,
            sourceUrl: true,
            status: true,
            views: true,
            likes: true,
            isAdult: true,
            createdAt: true,
            updatedAt: true,
            coverImage: true,
            coverApprovalStatus: true,
            approvalStatus: true,
            author: { select: { id: true, name: true, image: true } },
            category: { select: { name: true, slug: true } },
            _count: { select: { chapters: true, bookmarks: true } },
            storyTags: {
              select: { tag: { select: { name: true, slug: true, type: true } } },
            },
          },
        }),
        prisma.story.count({ where }),
      ]);

      return {
        stories: stories.map((s) => {
          const { storyTags, coverImage, coverApprovalStatus, approvalStatus, ...rest } = s;
          return {
            ...rest,
            coverUrl: deriveCoverUrl(s),
            storyTagList: storyTags.map((st) => st.tag),
          };
        }),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      };
    });

    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json(result);
  } catch (error) {
    console.error("Error fetching stories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/stories/:id/cover — serve cover image (cloud URL redirect or base64 binary)
router.get("/:id/cover", async (req: Request, res: Response) => {
  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id },
      select: { coverImage: true, approvalStatus: true, coverApprovalStatus: true },
    });
    if (!story?.coverImage) return res.status(404).end();

    // Serve cover logic:
    // - Approved story: always serve cover UNLESS cover was explicitly rejected
    // - Pending/other story: serve only if cover itself was approved
    const coverRejected = story.coverApprovalStatus === "rejected";
    const coverOk = story.approvalStatus === "approved"
      ? !coverRejected
      : story.coverApprovalStatus === "approved";
    if (!coverOk) return res.status(403).end();

    // If coverImage is a URL (cloud storage), stream via backend instead of redirect.
    // This avoids client-side failures when public CDN URL returns non-200 (e.g. 402).
    if (story.coverImage.startsWith("http://") || story.coverImage.startsWith("https://")) {
      try {
        const remote = await fetch(story.coverImage);
        if (remote.ok) {
          const contentType = remote.headers.get("content-type") || "image/webp";
          const buffer = Buffer.from(await remote.arrayBuffer());
          res.set("Content-Type", contentType);
          res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
          return res.send(buffer);
        }
      } catch {
        // Fallback below
      }

      const downloaded = await downloadCoverByPublicUrl(story.coverImage);
      if (downloaded) {
        res.set("Content-Type", downloaded.mimeType);
        res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
        return res.send(downloaded.buffer);
      }

      return res.status(502).end();
    }

    // Legacy: base64 data URI — serve as binary
    const match = story.coverImage.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!match) return res.status(404).end();

    const [, mimeType, base64Data] = match;
    const buffer = Buffer.from(base64Data, "base64");

    res.set("Content-Type", mimeType);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch {
    res.status(500).end();
  }
});

export default router;
