import { Router, Request as ExRequest, Response } from "express";
import { getRecommendations, getHomeRecommendations, logRecommendation, updateUserProfile } from "../lib/recommendationEngine";
import { authOptional } from "../middleware/auth";
import type { AuthRequest } from "../middleware/auth";
import { cached, SHORT_TTL, MEDIUM_TTL } from "../lib/cache";

const router = Router();

/**
 * GET /api/recommendations
 * Get personalized story recommendations
 *
 * Query params:
 *   - type: "personalized" | "trending" | "new" | "similar"
 *   - storyId: string (required for "similar" type)
 *   - limit: number (default 10, max 50)
 *   - exclude: comma-separated story IDs to exclude
 */
router.get("/", authOptional, async (req: AuthRequest, res: Response) => {
  try {
    const type = (req.query.type as string) || "personalized";
    const storyId = req.query.storyId as string | undefined;
    const category = (req.query.category as string) || undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const excludeParam = req.query.exclude as string;
    const excludeStoryIds = excludeParam ? excludeParam.split(",").filter(Boolean) : [];

    // Get user ID if authenticated
    const userId = req.user?.sub ?? null;

    // A5: Cache trending/new/similar/hotByCategory (không cache personalized vì theo user)
    const cacheable = type === "trending" || type === "new" || type === "similar" || type === "hotByCategory";
    const ttl = type === "trending" || type === "hotByCategory" ? MEDIUM_TTL : SHORT_TTL;
    const cacheKey = cacheable
      ? `rec:${type}:${storyId || ""}:${category || ""}:${limit}:${excludeStoryIds.join(",")}`
      : null;

    const fetchRecs = async () => getRecommendations({
      userId,
      storyId: storyId || null,
      category: category || null,
      limit,
      excludeStoryIds,
      type: type as "personalized" | "trending" | "new" | "similar" | "hotByCategory",
    });

    const recommendations = cacheKey
      ? await cached(cacheKey, ttl, fetchRecs)
      : await fetchRecs();

    // Cache-Control header cho CDN/browser
    if (cacheable) {
      res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    } else {
      res.set("Cache-Control", "private, no-cache");
    }

    res.json({
      recommendations,
      meta: {
        type,
        userId: userId || null,
        storyId: storyId || null,
        category: category || null,
        limit,
        count: recommendations.length,
      },
    });
  } catch (error) {
    console.error("[Recommendations] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/recommendations/log
 * Log a recommendation interaction (click/view)
 */
router.post("/log", authOptional, async (req: AuthRequest, res: Response) => {
  try {
    const { storyId, action } = req.body;
    const userId = req.user?.sub;

    if (!storyId) {
      return res.status(400).json({ error: "storyId is required" });
    }

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (action === "click") {
      await logRecommendation(userId, storyId, "popular");
    }

    // Update user profile based on interaction
    if (action === "view" || action === "click") {
      await updateUserProfile(userId, storyId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[Recommendations] Log error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/recommendations/similar/:storyId
 * Get similar stories for a given story
 */
router.get("/similar/:storyId", async (req: AuthRequest, res: Response) => {
  try {
    const { storyId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const recommendations = await getRecommendations({
      storyId,
      limit,
      type: "similar",
    });

    res.json({
      recommendations,
      meta: {
        type: "similar",
        storyId,
        limit,
        count: recommendations.length,
      },
    });
  } catch (error) {
    console.error("[Recommendations] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/recommendations/trending
 * Get trending stories
 */
router.get("/trending", async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const recommendations = await getRecommendations({
      limit,
      type: "trending",
    });

    res.json({
      recommendations,
      meta: {
        type: "trending",
        limit,
        count: recommendations.length,
      },
    });
  } catch (error) {
    console.error("[Recommendations] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/recommendations/new
 * Get newly released stories
 */
router.get("/new", async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const recommendations = await getRecommendations({
      limit,
      type: "new",
    });

    res.json({
      recommendations,
      meta: {
        type: "new",
        limit,
        count: recommendations.length,
      },
    });
  } catch (error) {
    console.error("[Recommendations] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/recommendations/hot-by-category?category=Tiên+Hiệp
 * Get hot stories within a specific category (genre)
 * - 7-day view count aggregation
 * - Fallback to total views + likes if ViewLog sparse
 */
router.get("/hot-by-category", async (req: AuthRequest, res: Response) => {
  try {
    const category = req.query.category as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    if (!category) {
      return res.status(400).json({ error: "category query param is required" });
    }

    const recommendations = await getRecommendations({
      category,
      limit,
      type: "hotByCategory",
    });

    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    res.json({
      recommendations,
      meta: {
        type: "hotByCategory",
        category,
        limit,
        count: recommendations.length,
      },
    });
  } catch (error) {
    console.error("[Recommendations] hot-by-category error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/recommendations/home — combined payload for the home page ──
// Returns: personalized row (logged-in only) + 5 hot-by-genre rows
// hot-by-genre rows are cached 5 min (MEDIUM_TTL); personalized is per-user
router.get("/home", authOptional, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 12, 30);
    const excludeParam = req.query.exclude as string;
    const excludeStoryIds = excludeParam ? excludeParam.split(",").filter(Boolean) : [];
    const userId = req.user?.sub ?? null;

    const cacheKey = `rec:home:${userId || "anon"}:${limit}:${excludeStoryIds.length}`;

    const result = await cached(cacheKey, MEDIUM_TTL, () =>
      getHomeRecommendations({ userId, limit, excludeStoryIds })
    );

    res.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
    res.json(result);
  } catch (error) {
    console.error("[Recommendations] /home error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
