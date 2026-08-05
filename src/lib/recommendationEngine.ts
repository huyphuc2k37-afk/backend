/**
 * Recommendation Engine
 *
 * Provides personalized story recommendations using:
 * 1. Content-based filtering (genre, tags, author)
 * 2. Collaborative filtering (users like you also read)
 * 3. Popularity-based (hot/trending)
 * 4. New releases
 * 5. Fallback to random popular stories
 */

import prisma from "./prisma";
import { cached, SHORT_TTL, MEDIUM_TTL } from "./cache";
import { Prisma } from "@prisma/client";

/**
 * Hot-by-genre target list — 5 genres người dùng yêu cầu.
 * tagSlug là slug của Tag đã được seed; categorySlug là slug của Category.
 * Slugs đã verify với DB: dam-my(43), ngon-tinh(95), trinh-tham(29), kinh-di(46), hoc-duong(33).
 */
export const TARGET_HOT_GENRES: Array<{
  label: string;
  tagSlug: string;
  categorySlug: string;
}> = [
  { label: "Đam mỹ", tagSlug: "dam-my", categorySlug: "tinh-cam" },
  { label: "Ngôn tình", tagSlug: "ngon-tinh", categorySlug: "tinh-cam" },
  { label: "Trinh thám", tagSlug: "trinh-tham", categorySlug: "tam-ly-toi-pham" },
  { label: "Kinh dị", tagSlug: "kinh-di", categorySlug: "kinh-di-tam-linh" },
  { label: "Thanh xuân vườn trường", tagSlug: "hoc-duong", categorySlug: "hoc-duong-do-thi" },
];

/**
 * Build slug từ label tiếng Việt — dùng khi frontend gửi `category=`
 * cho API `/api/recommendations?type=hotByCategory`. Tra cứu trong bảng
 * tag thật (case-insensitive) thay vì nhớ danh sách cứng.
 *
 * Nếu không tìm thấy slug khớp với tag đã seed, fallback về lowercase + dash.
 */
export function labelToTagSlug(label: string): string {
  const normalized = label.trim().toLowerCase();
  const found = TARGET_HOT_GENRES.find(
    (g) => g.label.toLowerCase() === normalized
  );
  if (found) return found.tagSlug;
  // Fallback heuristic
  return normalized.replace(/\s+/g, "-");
}

export interface Recommendation {
  id: string;
  title: string;
  slug: string;
  coverImage: string | null;
  author: { id: string; name: string };
  genre: string;
  views: number;
  likes: number;
  reason: RecommendationReason;
  score: number;
  /** Số chương — có thể undefined ở vài nhánh query cũ; UI dùng fallback 0. */
  chapterCount?: number;
  _count?: { chapters: number };
}

export type RecommendationReason =
  | "similar"
  | "popular"
  | "new"
  | "genre"
  | "author"
  | "collaborative"
  | "trending";

export interface RecommendationOptions {
  userId?: string | null;
  storyId?: string | null; // For "similar stories"
  limit?: number;
  excludeStoryIds?: string[];
  genre?: string | null;
  category?: string | null; // For "hot by category"
  type?: "personalized" | "trending" | "new" | "similar" | "hotByCategory";
}

/**
 * Get user reading profile
 */
async function getUserProfile(userId: string) {
  const profile = await prisma.userReadingProfile.findUnique({
    where: { userId },
  });

  if (profile) {
    return profile;
  }

  // Build profile from user's reading history
  const readHistory = await prisma.readHistory.findMany({
    where: { userId },
    include: {
      story: {
        select: { genre: true, storyTags: { include: { tag: true } } },
      },
    },
    orderBy: { lastReadAt: "desc" },
    take: 50,
  });

  if (readHistory.length === 0) {
    return null;
  }

  // Calculate favorite genres
  const genreCount: Record<string, number> = {};
  for (const history of readHistory) {
    const genres = history.story.genre.split(",").map((g) => g.trim());
    for (const genre of genres) {
      genreCount[genre] = (genreCount[genre] || 0) + 1;
    }
  }

  const favoriteGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g);

  // Create profile
  const newProfile = await prisma.userReadingProfile.create({
    data: {
      userId,
      favoriteGenres,
      avgReadLength: Math.floor(readHistory.length / 10),
      preferredOrigin: ["original"],
    },
  });

  return newProfile;
}

/**
 * Content-based filtering: Find similar stories by genre/tags
 *
 * NOTE: Bug fix — Jaccard tag similarity giờ được tính đúng bằng cách
 * fetch tags của candidate story song song với source story.
 */
async function getSimilarStories(
  storyId: string,
  limit: number,
  excludeIds: string[]
): Promise<Recommendation[]> {
  const sourceStory = await prisma.story.findUnique({
    where: { id: storyId },
    select: {
      genre: true,
      storyTags: { select: { tagId: true } },
      categoryId: true,
      authorId: true,
    },
  });

  if (!sourceStory) {
    return [];
  }

  const sourceTags = sourceStory.storyTags.map((st) => st.tagId);
  const sourceGenres = sourceStory.genre.split(",").map((g) => g.trim()).filter(Boolean);

  const similarStories = await prisma.story.findMany({
    where: {
      id: { notIn: [storyId, ...excludeIds] },
      approvalStatus: "approved",
      OR: [
        ...(sourceGenres.length > 0 ? [{ genre: { in: sourceGenres } }] : []),
        ...(sourceTags.length > 0 ? [{ storyTags: { some: { tagId: { in: sourceTags } } } }] : []),
        ...(sourceStory.categoryId ? [{ categoryId: sourceStory.categoryId }] : []),
        { authorId: sourceStory.authorId },
      ],
    },
    select: {
      id: true,
      title: true,
      slug: true,
      coverImage: true,
      genre: true,
      views: true,
      likes: true,
      author: { select: { id: true, name: true } },
      storyTags: { select: { tagId: true } },
    },
    take: limit * 2,
  });

  const sourceTagSet = new Set(sourceTags);
  const scored = similarStories.map((story) => {
    let score = 0;

    // Genre match (intersection)
    const storyGenres = story.genre.split(",").map((g) => g.trim()).filter(Boolean);
    const genreOverlap = storyGenres.filter((g) => sourceGenres.includes(g)).length;
    if (sourceGenres.length > 0) {
      score += (genreOverlap / sourceGenres.length) * 0.3;
    }

    // Tag Jaccard — dùng tags của candidate story (fix bug cũ dùng sourceTags)
    const candidateTagIds = story.storyTags.map((st) => st.tagId);
    const candidateTagSet = new Set(candidateTagIds);
    const union = new Set([...sourceTagSet, ...candidateTagSet]);
    const intersection = candidateTagIds.filter((id) => sourceTagSet.has(id)).length;
    const jaccard = union.size > 0 ? intersection / union.size : 0;
    score += jaccard * 0.4;

    // Author match
    if (story.author.id === sourceStory.authorId) {
      score += 0.2;
    }

    // Popularity bonus (log-scale)
    score += Math.min(Math.log10(story.views + 1) / 5, 0.1);

    return {
      ...story,
      reason: "similar" as RecommendationReason,
      score: Math.min(score, 1),
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Collaborative filtering: Users who read this also read...
 */
async function getCollaborativeRecommendations(
  userId: string,
  limit: number,
  excludeIds: string[]
): Promise<Recommendation[]> {
  // Find stories the user has read
  const userReadStories = await prisma.readHistory.findMany({
    where: { userId },
    select: { storyId: true },
    take: 20,
  });

  if (userReadStories.length === 0) {
    return [];
  }

  const userStoryIds = userReadStories.map((r) => r.storyId);

  // Find other users who read these stories
  const similarUsers = await prisma.readHistory.findMany({
    where: {
      storyId: { in: userStoryIds },
      userId: { not: userId },
    },
    select: { userId: true },
    distinct: ["userId"],
    take: 50,
  });

  const similarUserIds = similarUsers.map((u) => u.userId);

  if (similarUserIds.length === 0) {
    return [];
  }

  // Find stories those users read (that current user hasn't read)
  const recommendations = await prisma.readHistory.groupBy({
    by: ["storyId"],
    where: {
      userId: { in: similarUserIds },
      storyId: { notIn: [...userStoryIds, ...excludeIds] },
    },
    _count: { storyId: true },
    orderBy: { _count: { storyId: "desc" } },
    take: limit * 2,
  });

  const storyIds = recommendations.map((r) => r.storyId);

  const stories = await prisma.story.findMany({
    where: { id: { in: storyIds }, approvalStatus: "approved" },
    select: {
      id: true,
      title: true,
      slug: true,
      coverImage: true,
      genre: true,
      views: true,
      likes: true,
      author: { select: { id: true, name: true } },
    },
  });

  // Map count to score
  const countMap = new Map(recommendations.map((r) => [r.storyId, r._count.storyId]));
  const maxCount = Math.max(...[...countMap.values()]);

  return stories
    .map((story) => ({
      ...story,
      reason: "collaborative" as RecommendationReason,
      score: (countMap.get(story.id) || 0) / maxCount,
    }))
    .slice(0, limit);
}

/**
 * Genre-based recommendations using user's profile
 */
async function getGenreRecommendations(
  userId: string,
  limit: number,
  excludeIds: string[]
): Promise<Recommendation[]> {
  const profile = await getUserProfile(userId);

  if (!profile || profile.favoriteGenres.length === 0) {
    return [];
  }

  // Find stories in user's favorite genres
  const stories = await prisma.story.findMany({
    where: {
      id: { notIn: excludeIds },
      approvalStatus: "approved",
      OR: profile.favoriteGenres.map((genre) => ({ genre: { contains: genre } })),
    },
    select: {
      id: true,
      title: true,
      slug: true,
      coverImage: true,
      genre: true,
      views: true,
      likes: true,
      author: { select: { id: true, name: true } },
    },
    orderBy: { views: "desc" },
    take: limit * 2,
  });

  return stories
    .map((story) => {
      // Score: log-normalized views (deterministic)
      const score = Math.min(Math.log10(story.views + 1) / 5, 1);
      return {
        ...story,
        reason: "genre" as RecommendationReason,
        score,
      };
    })
    .slice(0, limit);
}

/**
 * Trending/Popular stories
 *
 * NOTE: Bug fix — dùng Prisma.sql parameterized array cho excludeIds
 * (trước đây dùng raw join, SQL injection risk khi id có quote/comma).
 */
async function getTrendingStories(
  limit: number,
  excludeIds: string[]
): Promise<Recommendation[]> {
  return cached(
    `recommendations:trending:${limit}`,
    SHORT_TTL,
    async () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Build safe exclusion clause
      const excludeClause =
        excludeIds.length > 0
          ? Prisma.sql`AND s.id NOT IN (${Prisma.join(excludeIds.map((id) => Prisma.sql`${id}`))})`
          : Prisma.sql``;

      const trending = await prisma.$queryRaw<{ storyId: string; viewCount: bigint }[]>`
        SELECT vl."storyId", COUNT(*) as "viewCount"
        FROM "ViewLog" vl
        JOIN "Story" s ON s.id = vl."storyId"
        WHERE vl."createdAt" >= ${sevenDaysAgo}
          AND s."approvalStatus" = 'approved'
          ${excludeClause}
        GROUP BY vl."storyId"
        ORDER BY "viewCount" DESC
        LIMIT ${limit * 2}
      `;

      const storyIds = trending.map((t) => t.storyId);

      if (storyIds.length === 0) {
        return prisma.story.findMany({
          where: { approvalStatus: "approved", id: { notIn: excludeIds } },
          select: {
            id: true,
            title: true,
            slug: true,
            coverImage: true,
            genre: true,
            views: true,
            likes: true,
            boostScore: true,
            author: { select: { id: true, name: true } },
          },
          orderBy: [{ boostScore: "desc" }, { views: "desc" }],
          take: limit,
        });
      }

      return prisma.story.findMany({
        where: { id: { in: storyIds } },
        select: {
          id: true,
          title: true,
          slug: true,
          coverImage: true,
          genre: true,
          views: true,
          likes: true,
          boostScore: true,
          author: { select: { id: true, name: true } },
        },
      });
    }
  ) as Promise<Recommendation[]>;
}

/**
 * B6: Top boosted stories — paginated for homepage leaderboard.
 * Returns stories sorted by boostScore DESC. Uses time-decay so a fresh boost
 * outranks an old one with the same score.
 */
export async function getBoostedStories(
  limit: number = 12
): Promise<Recommendation[]> {
  return cached(
    `recommendations:boosted:${limit}`,
    SHORT_TTL,
    async () => {
      const stories = await prisma.story.findMany({
        where: {
          approvalStatus: "approved",
          boostScore: { gt: 0 },
        },
        // Recency-tiebreak so newest boosts surface above stale ones
        orderBy: [{ boostScore: "desc" }, { boostedAt: "desc" }, { views: "desc" }],
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          coverImage: true,
          genre: true,
          views: true,
          likes: true,
          boostScore: true,
          boostedAt: true,
          author: { select: { id: true, name: true } },
        },
      });
      return stories.map((s) => ({
        ...s,
        reason: "trending" as RecommendationReason,
        // Surface boostScore into score so it influences downstream ranking
        score: Math.min(0.5 + (s.boostScore ?? 0) * 0.1, 1),
      }));
    }
  ) as Promise<Recommendation[]>;
}

/**
 * Hot stories by category (genre) — used for "Hot theo thể loại" section
 * Score = views in last 7 days + likes boost + recency boost
 */
async function getHotByCategoryStories(
  category: string,
  limit: number,
  excludeIds: string[]
): Promise<Recommendation[]> {
  // Resolve the input to a tag slug. The frontend may send either:
  //   - a slug ("dam-my", "ngon-tinh", ...)
  //   - a label ("Đam mỹ", "Ngôn tình", ...) from reading history
  const tagSlug = labelToTagSlug(category);

  return cached(
    `recommendations:hotByTag:${tagSlug}:${limit}`,
    SHORT_TTL,
    async () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Build parameterized exclusion clause
      const excludeClause =
        excludeIds.length > 0
          ? Prisma.sql`AND s.id NOT IN (${Prisma.join(excludeIds.map((id) => Prisma.sql`${id}`))})`
          : Prisma.sql``;

      // Recent views scoped to the tag via StoryTag → Tag.slug (accurate membership)
      const recent = await prisma.$queryRaw<{ storyId: string; viewCount: bigint }[]>`
        SELECT vl."storyId"::text as "storyId", COUNT(*) as "viewCount"
        FROM "ViewLog" vl
        JOIN "Story" s ON s.id = vl."storyId"
        JOIN "StoryTag" st ON st."storyId" = s.id
        JOIN "Tag" t ON t.id = st."tagId"
        WHERE vl."createdAt" >= ${sevenDaysAgo}
          AND s."approvalStatus" = 'approved'
          AND t."slug" = ${tagSlug}
          ${excludeClause}
        GROUP BY vl."storyId"
        ORDER BY "viewCount" DESC
        LIMIT ${limit * 2}
      `;

      const recentIds = recent.map((r) => r.storyId);

      // Fallback: any story that has the tag (in case ViewLog is sparse)
      const fallback = await prisma.story.findMany({
        where: {
          approvalStatus: "approved",
          storyTags: { some: { tag: { slug: tagSlug } } },
          id: { notIn: [...excludeIds, ...recentIds] },
        },
        select: {
          id: true,
          title: true,
          slug: true,
          coverImage: true,
          genre: true,
          views: true,
          likes: true,
          author: { select: { id: true, name: true } },
        },
        orderBy: [{ views: "desc" }, { likes: "desc" }],
        take: limit,
      });

      // Fetch full info for recent IDs
      const recentStories = await prisma.story.findMany({
        where: { id: { in: recentIds }, approvalStatus: "approved" },
        select: {
          id: true,
          title: true,
          slug: true,
          coverImage: true,
          genre: true,
          views: true,
          likes: true,
          author: { select: { id: true, name: true } },
        },
      });

      const countMap = new Map(
        recent.map((r) => [r.storyId, Number(r.viewCount)])
      );
      const maxCount = Math.max(1, ...countMap.values());

      const scoredRecent = recentStories
        .map((story) => ({
          ...story,
          reason: "trending" as RecommendationReason,
          score: 0.5 + (countMap.get(story.id) || 0) / maxCount * 0.5,
        }))
        .sort((a, b) => b.score - a.score);

      const combined = [
        ...scoredRecent,
        ...fallback.map((s) => ({ ...s, reason: "popular" as RecommendationReason, score: 0.5 })),
      ];

      return combined
        .filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i)
        .slice(0, limit);
    }
  ) as Promise<Recommendation[]>;
}

/**
 * Hot stories filtered by a Tag slug (e.g., "dam-my", "ngon-tinh").
 * Used by the /home endpoint to power 5 dedicated "Hot theo thể loại" rows.
 *
 * Score = recentViews (7-day) + log10(views + 1) + likes + ratingCount
 */
async function getHotByTagSlug(
  tagSlug: string,
  limit: number,
  excludeIds: string[]
): Promise<Recommendation[]> {
  return cached(
    `recommendations:hotByTag:${tagSlug}:${limit}`,
    MEDIUM_TTL,
    async () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Build parameterized exclusion clause
      const excludeClause =
        excludeIds.length > 0
          ? Prisma.sql`AND s.id NOT IN (${Prisma.join(excludeIds.map((id) => Prisma.sql`${id}`))})`
          : Prisma.sql``;

      // Recent views scoped to the tag (joins StoryTag → Tag.slug)
      const recent = await prisma.$queryRaw<{ storyId: string; viewCount: bigint }[]>`
        SELECT vl."storyId"::text as "storyId", COUNT(*) as "viewCount"
        FROM "ViewLog" vl
        JOIN "Story" s ON s.id = vl."storyId"
        JOIN "StoryTag" st ON st."storyId" = s.id
        JOIN "Tag" t ON t.id = st."tagId"
        WHERE vl."createdAt" >= ${sevenDaysAgo}
          AND s."approvalStatus" = 'approved'
          AND t."slug" = ${tagSlug}
          ${excludeClause}
        GROUP BY vl."storyId"
        ORDER BY "viewCount" DESC
        LIMIT ${limit * 2}
      `;

      const recentIds = recent.map((r) => r.storyId);

      const candidates = await prisma.story.findMany({
        where: {
          approvalStatus: "approved",
          OR: [
            { id: { in: recentIds } },
            {
              storyTags: { some: { tag: { slug: tagSlug } } },
              ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
            },
          ],
        },
        select: {
          id: true,
          title: true,
          slug: true,
          coverImage: true,
          genre: true,
          views: true,
          likes: true,
          ratingCount: true,
          author: { select: { id: true, name: true } },
          _count: { select: { chapters: { where: { approvalStatus: "approved" } } } },
        },
        take: limit,
      });

      const viewCountMap = new Map(recent.map((r) => [r.storyId, Number(r.viewCount)]));

      const scored = candidates.map((story) => {
        const recentViews = viewCountMap.get(story.id) || 0;
        const score = Math.min(
          recentViews * 1.0 + Math.log10(story.views + 1) * 0.5 + story.likes * 0.3 + story.ratingCount * 0.2,
          100
        );
        return {
          ...story,
          chapterCount: story._count?.chapters ?? 0,
          reason: "trending" as RecommendationReason,
          score,
        };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    }
  ) as Promise<Recommendation[]>;
}

/**
 * New releases (last 7 days)
 */
async function getNewReleases(
  limit: number,
  excludeIds: string[]
): Promise<Recommendation[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const stories = await prisma.story.findMany({
    where: {
      id: { notIn: excludeIds },
      approvalStatus: "approved",
      createdAt: { gte: sevenDaysAgo },
    },
    select: {
      id: true,
      title: true,
      slug: true,
      coverImage: true,
      genre: true,
      views: true,
      likes: true,
      author: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return stories.map((story) => ({
    ...story,
    reason: "new" as RecommendationReason,
    score: 1,
  }));
}

/**
 * Main recommendation function
 */
export async function getRecommendations(
  options: RecommendationOptions
): Promise<Recommendation[]> {
  const {
    userId = null,
    storyId = null,
    limit = 10,
    excludeStoryIds = [],
    category = null,
    type = "personalized",
  } = options;

  // Log recommendation request
  if (userId) {
    console.log(`[Recommendations] Getting ${type} recommendations for user ${userId}`);
  }

  switch (type) {
    case "similar":
      if (!storyId) {
        console.warn("[Recommendations] similar type requires storyId");
        return [];
      }
      return getSimilarStories(storyId, limit, excludeStoryIds);

    case "trending":
      return getTrendingStories(limit, excludeStoryIds);

    case "new":
      return getNewReleases(limit, excludeStoryIds);

    case "hotByCategory":
      if (!category) {
        console.warn("[Recommendations] hotByCategory type requires category");
        return getTrendingStories(limit, excludeStoryIds);
      }
      return getHotByCategoryStories(category, limit, excludeStoryIds);

    case "personalized":
    default:
      if (!userId) {
        // Fallback to trending for anonymous users
        return getTrendingStories(limit, excludeStoryIds);
      }

      // Combine multiple recommendation strategies
      const [collaborative, genre] = await Promise.all([
        getCollaborativeRecommendations(userId, Math.ceil(limit * 0.4), excludeStoryIds),
        getGenreRecommendations(userId, Math.ceil(limit * 0.3), excludeStoryIds),
      ]);

      // Get trending to fill remaining
      const trending = await getTrendingStories(
        limit - collaborative.length - genre.length,
        [...excludeStoryIds, ...collaborative.map((c) => c.id), ...genre.map((g) => g.id)]
      );

      return [...collaborative, ...genre, ...trending].slice(0, limit);
  }
}

/**
 * Log a recommendation interaction
 */
export async function logRecommendation(
  userId: string,
  storyId: string,
  reason: RecommendationReason
): Promise<void> {
  try {
    await prisma.recommendationLog.create({
      data: { userId, storyId, reason },
    });
  } catch (error) {
    console.error("[Recommendations] Failed to log:", error);
  }
}

/**
 * Update user reading profile
 */
export async function updateUserProfile(
  userId: string,
  storyId: string
): Promise<void> {
  try {
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { genre: true, storyOrigin: true },
    });

    if (!story) return;

    const profile = await prisma.userReadingProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      // Create initial profile
      await prisma.userReadingProfile.create({
        data: {
          userId,
          favoriteGenres: [story.genre.split(",")[0].trim()],
          preferredOrigin: [story.storyOrigin],
        },
      });
    } else {
      // Update existing profile
      const genres = story.genre.split(",").map((g) => g.trim());
      const favoriteGenres = [...new Set([...profile.favoriteGenres, ...genres])].slice(0, 10);

      await prisma.userReadingProfile.update({
        where: { userId },
        data: {
          favoriteGenres,
          lastUpdated: new Date(),
        },
      });
    }
  } catch (error) {
    console.error("[Recommendations] Failed to update profile:", error);
  }
}

/**
 * Home page combined payload:
 *   - personalized row (logged-in only)
 *   - 5 hot-by-genre rows (always, cached 5 min)
 */
export interface HomeRecommendations {
  personalized: Recommendation[] | null;
  hotByGenre: Record<string, Recommendation[]>;
  meta: {
    userId: string | null;
    cachedAt: string;
    genreStrategy: "history-biased" | "static";
  };
}

export async function getHomeRecommendations(opts: {
  userId?: string | null;
  limit?: number;
  excludeStoryIds?: string[];
}): Promise<HomeRecommendations> {
  const limit = Math.min(50, opts.limit ?? 12);
  const exclude = opts.excludeStoryIds ?? [];

  // Personalized slice
  let personalized: Recommendation[] | null = null;
  if (opts.userId) {
    const [cf, gn] = await Promise.all([
      getCollaborativeRecommendations(opts.userId, Math.ceil(limit * 0.4), exclude),
      getGenreRecommendations(opts.userId, Math.ceil(limit * 0.3), exclude),
    ]);
    const used = new Set([...cf.map((c) => c.id), ...gn.map((g) => g.id)]);
    const trending = await getTrendingStories(
      Math.max(0, limit - cf.length - gn.length),
      [...exclude, ...used]
    );
    personalized = [...cf, ...gn, ...trending].slice(0, limit);
  }

  // Hot-by-genre rows (5 fixed targets, each fetched in parallel)
  const hotByGenreEntries = await Promise.all(
    TARGET_HOT_GENRES.map(async (g) => {
      const rows = await getHotByTagSlug(g.tagSlug, limit, exclude);
      return [g.label, rows] as const;
    })
  );
  const hotByGenre: Record<string, Recommendation[]> = {};
  for (const [label, rows] of hotByGenreEntries) {
    hotByGenre[label] = rows;
  }

  // Enrich all recommendations with `chapterCount` for UI display.
  // (getHotByTagSlug đã có sẵn; các nhánh personalized dùng raw Prisma nên ta batch-fetch.)
  const seenIds = new Set<string>();
  const enrichAll = (rows?: Recommendation[] | null) => {
    rows?.forEach((r) => r?.id && seenIds.add(r.id));
  };
  enrichAll(personalized);
  Object.values(hotByGenre).forEach(enrichAll);

  if (seenIds.size > 0) {
    const counts = await prisma.chapter.groupBy({
      by: ["storyId"],
      where: { storyId: { in: Array.from(seenIds) }, approvalStatus: "approved" },
      _count: { _all: true },
    });
    const map = new Map(counts.map((c) => [c.storyId, c._count._all]));
    const apply = (rows?: Recommendation[] | null) => {
      rows?.forEach((r) => {
        if (!r) return;
        const c = map.get(r.id);
        if (c != null) r.chapterCount = c;
      });
    };
    apply(personalized);
    Object.values(hotByGenre).forEach(apply);
  }

  return {
    personalized,
    hotByGenre,
    meta: {
      userId: opts.userId ?? null,
      cachedAt: new Date().toISOString(),
      genreStrategy: opts.userId ? "history-biased" : "static",
    },
  };
}
