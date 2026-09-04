import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { compressBase64Image } from "../lib/compressImage";
import { cached, SHORT_TTL } from "../lib/cache";
import { downloadCoverByPublicUrl } from "../lib/supabaseStorage";
import { deriveCoverUrl } from "../lib/cover";

const router = Router();

/** In-memory cover cache: id -> { mime, buffer, etag, ts }
 *  Avoids re-fetching from Cloudinary/Supabase for every page view.
 *  Size-bounded (LRU) and TTL-bounded (24h). Each entry is the raw image bytes. */
type CoverCacheEntry = { mime: string; buffer: Buffer; etag: string; ts: number };
const coverCache = new Map<string, CoverCacheEntry>();
const COVER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Capped to 500 entries (~100 MB worst case at 200 KB/cover) so the cache
// cannot exhaust Railway Hobby plan RAM (~512 MB–1 GB).
const COVER_CACHE_MAX = 500;
function pruneCoverCache() {
  const now = Date.now();
  for (const [k, v] of coverCache) {
    if (now - v.ts > COVER_CACHE_TTL_MS) coverCache.delete(k);
  }
  // LRU trim
  if (coverCache.size > COVER_CACHE_MAX) {
    const excess = coverCache.size - COVER_CACHE_MAX;
    const keys = coverCache.keys();
    for (let i = 0; i < excess; i++) coverCache.delete(keys.next().value as string);
  }
}

// (deriveCoverUrl is imported from ../lib/cover; see that file for the canonical logic)

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

      const mapped = stories.map((s) => {
        const { storyTags, coverImage, coverApprovalStatus, approvalStatus, ...rest } = s;
        const coverUrl = deriveCoverUrl(s);
        return {
          ...rest,
          coverUrl,
          storyTagList: storyTags.map((st) => st.tag),
        };
      });

      return {
        stories: mapped,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      };
    });

    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.json(result);
  } catch (error) {
    console.error("Error fetching stories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/stories/:id/cover — serve cover image (cloud URL redirect or base64 binary)
router.get("/:id/cover", async (req: Request, res: Response) => {
  try {
    const storyId = req.params.id;

    // Fast path: in-memory cache hit (also validate via ETag)
    pruneCoverCache();
    const cached = coverCache.get(storyId);
    if (cached && Date.now() - cached.ts <= COVER_CACHE_TTL_MS) {
      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch === cached.etag) return res.status(304).end();
      res.set("Content-Type", cached.mime);
      res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.set("ETag", cached.etag);
      return res.send(cached.buffer);
    }

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { coverImage: true, approvalStatus: true, coverApprovalStatus: true, updatedAt: true },
    });
    if (!story?.coverImage) return res.status(404).end();
    // Serve cover logic:
    // - Approved story: always serve cover UNLESS cover was explicitly rejected
    // - Pending/other story: serve only if cover itself was approved
    const coverRejected = story.coverApprovalStatus === "rejected";
    const approvalSet = story.approvalStatus !== null && story.approvalStatus !== undefined;
    const coverStatusSet = story.coverApprovalStatus !== null && story.coverApprovalStatus !== undefined;
    const coverOk = !coverRejected && (
      (!approvalSet && !coverStatusSet) || // no status set at all — show it
      (approvalSet && story.approvalStatus === "approved") || // story approved
      (coverStatusSet && story.coverApprovalStatus === "approved") // cover explicitly approved
    );
    if (!coverOk) return res.status(403).end();

    // If coverImage is a URL (cloud storage), stream via backend instead of redirect.
    // This avoids client-side failures when public CDN URL returns non-200 (e.g. 402).
    const updatedAtStr = story.updatedAt instanceof Date ? story.updatedAt.toISOString() : String(story.updatedAt);
    const etagFor = () => `"${updatedAtStr.replace(/[^a-z0-9]/gi, "")}"`;
    if (story.coverImage.startsWith("http://") || story.coverImage.startsWith("https://")) {
      try {
        const remote = await fetch(story.coverImage);
        if (remote.ok) {
          const contentType = remote.headers.get("content-type") || "image/webp";
          const buffer = Buffer.from(await remote.arrayBuffer());
          const etag = etagFor();
          coverCache.set(storyId, { mime: contentType, buffer, etag, ts: Date.now() });
          const ifNoneMatch = req.headers["if-none-match"];
          if (ifNoneMatch === etag) return res.status(304).end();
          res.set("Content-Type", contentType);
          res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
          res.set("ETag", etag);
          return res.send(buffer);
        }
      } catch {
        // Fallback below
      }

      const downloaded = await downloadCoverByPublicUrl(story.coverImage);
      if (downloaded) {
        const etag = etagFor();
        coverCache.set(storyId, { mime: downloaded.mimeType, buffer: downloaded.buffer, etag, ts: Date.now() });
        const ifNoneMatch = req.headers["if-none-match"];
        if (ifNoneMatch === etag) return res.status(304).end();
        res.set("Content-Type", downloaded.mimeType);
        res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
        res.set("ETag", etag);
        return res.send(downloaded.buffer);
      }

      return res.status(502).end();
    }

    // Legacy: base64 data URI — serve as binary
    let imageValue = story.coverImage;
    // Try URL-decoding up to 3 times (the value may be single or double URL-encoded)
    for (let i = 0; i < 3; i++) {
      const base64Match = imageValue.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (base64Match) {
        const buffer = Buffer.from(base64Match[2], "base64");
        const etag = etagFor();
        coverCache.set(storyId, { mime: base64Match[1], buffer, etag, ts: Date.now() });
        const ifNoneMatch = req.headers["if-none-match"];
        if (ifNoneMatch === etag) return res.status(304).end();
        res.set("Content-Type", base64Match[1]);
        res.set("Cache-Control", "public, max-age=86400");
        res.set("ETag", etag);
        return res.send(buffer);
      }
      // Try decoding URL-encoded data
      try {
        const decoded = decodeURIComponent(imageValue);
        if (decoded === imageValue) break; // no change
        imageValue = decoded;
      } catch {
        // Malformed URI — give up decoding and fall through to SVG/text checks
        break;
      }
    }

    // After decoding, try SVG plain-text match
    // Some SVGs start with `<?xml ... ?>` declaration — strip it before serving.
    let svgValue = imageValue;
    if (svgValue.startsWith("<?xml")) {
      svgValue = svgValue.replace(/<\?xml[^?]*\?>\s*/, "");
    }
    if (svgValue.startsWith("<svg")) {
      res.set("Content-Type", "image/svg+xml");
      res.set("Cache-Control", "public, max-age=86400");
      return res.send(Buffer.from(svgValue, "utf8"));
    }

    return res.status(404).end();
  } catch (err) {
    console.error("[COVER] Error:", err);
    res.status(500).end();
  }
});

export default router;
