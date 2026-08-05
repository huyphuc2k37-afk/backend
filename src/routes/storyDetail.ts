import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { cached, SHORT_TTL, invalidateCache } from "../lib/cache";
import { authOptional } from "../middleware/auth";
import type { AuthRequest } from "../middleware/auth";
import { deriveCoverUrl } from "../lib/cover";

const router = Router();

/** Bot user-agent blacklist — counted as spam, not real views. Case-insensitive. */
const BOT_UA_REGEX = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegrambot|preview|monitor|headless|phantom|selenium|puppeteer|scrapy|httpclient|axios\/|node-fetch|python-requests|curl\/|wget\//i;

// ─── View Earning Config ─────────────────────────
const XU_PER_VIEW = 2; // xu tác giả nhận cho mỗi unique view

// ─── In-memory view buffer for batch updates ────
const viewBuffer = new Map<string, number>(); // storyId → count
const viewedRecently = new Map<string, number>(); // "ip:slug" → timestamp (fast-path cache)
const VIEW_COOLDOWN = 60 * 60 * 1000; // 1 view per IP per story per hour
const MAX_VIEW_MAP_SIZE = 50_000;
// A1: flush interval 30s → 5s để view near real-time
const FLUSH_INTERVAL = 5 * 1000; // flush every 5 seconds
const DAILY_VIEW_CAP_PER_IP = 50; // max 50 unique story views per IP per day

// ─── Banned IP cache (refresh every 5 min) ───────
let bannedIPs = new Set<string>();
async function refreshBannedIPs() {
  try {
    const banned = await prisma.bannedIP.findMany({ select: { ip: true } });
    bannedIPs = new Set(banned.map((b) => b.ip));
  } catch {}
}
refreshBannedIPs();
setInterval(refreshBannedIPs, 5 * 60 * 1000);

// ─── Settle view earnings for authors ────────────
// For each story where views > lastSettledViews,
// calculate delta and credit author with XU_PER_VIEW × delta xu.
async function settleViewEarnings() {
  try {
    const unsettled = await prisma.$queryRaw<
      { id: string; title: string; views: number; lastSettledViews: number; authorId: string }[]
    >`
      SELECT id, title, views, "lastSettledViews", "authorId"
      FROM "Story"
      WHERE views > "lastSettledViews"
        AND "approvalStatus" = 'approved'
    `;

    if (unsettled.length === 0) return;

    console.log(`💰 Settling view earnings for ${unsettled.length} stories...`);
    let totalSettled = 0;

    for (const story of unsettled) {
      const delta = story.views - story.lastSettledViews;
      if (delta <= 0) continue;

      const earnings = delta * XU_PER_VIEW;

      try {
        await prisma.$transaction([
          prisma.story.update({
            where: { id: story.id },
            data: { lastSettledViews: story.views },
          }),
          prisma.user.update({
            where: { id: story.authorId },
            data: { coinBalance: { increment: earnings } },
          }),
          prisma.authorEarning.create({
            data: {
              type: "view",
              amount: earnings,
              viewCount: delta,
              authorId: story.authorId,
              storyId: story.id,
              storyTitle: story.title,
              chapterTitle: `${delta} lượt xem × ${XU_PER_VIEW} xu`,
            },
          }),
        ]);
        totalSettled += earnings;
      } catch (err) {
        console.error(`❌ Failed to settle views for story ${story.id}:`, err);
      }
    }

    if (totalSettled > 0) {
      console.log(`✅ View earnings settled: ${totalSettled} xu total`);
    }
  } catch (err) {
    console.error("❌ settleViewEarnings error:", err);
  }
}

// ─── Flush + Settle helper (reused on interval and startup) ────
async function flushAndSettle() {
  // Clean expired IP dedup entries
  const now = Date.now();
  for (const [key, ts] of viewedRecently) {
    if (now - ts > VIEW_COOLDOWN) viewedRecently.delete(key);
  }

  // Flush view buffer to DB
  if (viewBuffer.size === 0) {
    await settleViewEarnings();
    return;
  }
  const entries = Array.from(viewBuffer.entries());
  viewBuffer.clear();

  console.log(`🔄 Flushing ${entries.length} story view counts...`);
  const flushedSlugs: string[] = [];
  for (const [storyId, count] of entries) {
    try {
      const updated = await prisma.story.update({
        where: { id: storyId },
        data: { views: { increment: count } },
        select: { slug: true },
      });
      flushedSlugs.push(updated.slug);
    } catch (err) {
      // Story might have been deleted
    }
  }
  invalidateCache("ranking:*");
  // Invalidate per-story cache so other viewers see updated view counts
  for (const slug of flushedSlugs) {
    invalidateCache(`story:${slug}`);
  }
  console.log(`✅ View flush complete`);

  // Now settle view earnings for authors
  await settleViewEarnings();

  // Cleanup old ViewLog entries (older than 25 hours — keep buffer for dedup)
  try {
    const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.viewLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  } catch {}
}

// Flush every 5 minutes
setInterval(flushAndSettle, FLUSH_INTERVAL);

// Startup: settle any unsettled views from before restart (runs once after 10s)
setTimeout(async () => {
  console.log("🚀 Startup: settling any pending view earnings...");
  await settleViewEarnings();
}, 10_000);

// GET /api/stories/:slug/views — view count real-time (A1)
// Phải đặt TRƯỚC route /:slug để tránh bị nuốt path
router.get("/:slug/views", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const story = await prisma.story.findUnique({
      where: { slug },
      select: { id: true, views: true, approvalStatus: true },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });
    if (story.approvalStatus !== "approved") {
      return res.status(403).json({ error: "Truyện chưa được duyệt" });
    }
    const pending = viewBuffer.get(story.id) || 0;
    res.json({
      storyId: story.id,
      views: story.views,
      pendingViews: pending,
      totalViews: story.views + pending,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching views:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/stories/:slug — get single story detail
router.get("/:slug", authOptional, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    const story = await cached(`story:${slug}`, SHORT_TTL, () =>
      prisma.story.findUnique({
        where: { slug },
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
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
          averageRating: true,
          ratingCount: true,
          isAdult: true,
          approvalStatus: true,
          coverImage: true,
          coverApprovalStatus: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, image: true, bio: true } },
          category: { select: { id: true, name: true, slug: true } },
          storyTags: {
            select: { tag: { select: { id: true, name: true, slug: true, type: true } } },
          },
          chapters: {
            // A6: hiển thị mọi chapter không bị rejected (pending vẫn xem được, mod thấy riêng ở /mod)
            where: { approvalStatus: { not: "rejected" } },
            select: { id: true, title: true, number: true, wordCount: true, isLocked: true, price: true, createdAt: true, updatedAt: true },
            orderBy: { number: "asc" },
          },
          _count: { select: { bookmarks: true, comments: true, storyLikes: true } },
        },
      })
    );

    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }

    // Block public access to unapproved stories
    if (story.approvalStatus !== "approved") {
      return res.status(403).json({ error: "Truyện chưa được duyệt" });
    }

    // Only count views from real browser clients (header gated)
    // ISR server-side fetches and bots won't send this header
    const shouldCountView = req.headers["x-count-view"] === "1";
    if (shouldCountView) {
      const rawIp = req.ip || req.headers["x-forwarded-for"] || "unknown";
      const viewerIp = typeof rawIp === "string" ? rawIp.split(",")[0].trim() : "unknown";
      const userAgent = req.headers["user-agent"] || "";
      const viewerUserId = req.user?.sub || null;

      // Bot filter — block crawlers/preview bots from inflating view counts
      const isBot = BOT_UA_REGEX.test(userAgent) || viewerIp === "unknown";

      // Debug log (dev only)
      if (process.env.NODE_ENV !== "production") {
        console.log(`[ViewLog] attempt slug=${slug} ip=${viewerIp} userId=${viewerUserId} bot=${isBot} ua="${userAgent.slice(0, 40)}"`);
      }

      // Skip banned IPs entirely
      if (!bannedIPs.has(viewerIp) && !isBot) {
        // Prefer userId for dedup (one user = one view), fallback to IP for anonymous
        const dedupKey = viewerUserId || viewerIp;
        const viewKey = `${dedupKey}:${slug}`;
        const lastViewed = viewedRecently.get(viewKey);
        const now = Date.now();

        // Fast-path: in-memory cache says recently viewed → skip
        if (!lastViewed || now - lastViewed > VIEW_COOLDOWN) {
          // Persistent dedup: check ViewLog in DB (survives restarts)
          const oneHourAgo = new Date(now - VIEW_COOLDOWN);
          const recentDbView = await prisma.viewLog.findFirst({
            where: {
              storyId: story.id,
              createdAt: { gte: oneHourAgo },
              ...(viewerUserId
                ? { userId: viewerUserId }
                : { ip: viewerIp }),
            },
            select: { id: true },
          });

          if (!recentDbView) {
            // Daily cap: max N unique story views per IP per day (anonymous only —
            // logged-in users get uncapped trust per account)
            let withinDailyCap = true;
            if (!viewerUserId) {
              const todayStart = new Date();
              todayStart.setHours(0, 0, 0, 0);
              const dailyCount = await prisma.viewLog.count({
                where: { ip: viewerIp, createdAt: { gte: todayStart } },
              });
              withinDailyCap = dailyCount < DAILY_VIEW_CAP_PER_IP;
            }

            if (withinDailyCap) {
              // Update in-memory cache
              if (viewedRecently.size >= MAX_VIEW_MAP_SIZE) {
                const oldest = viewedRecently.keys().next().value;
                if (oldest) viewedRecently.delete(oldest);
              }
              viewedRecently.set(viewKey, now);

              // Add to buffer
              viewBuffer.set(story.id, (viewBuffer.get(story.id) || 0) + 1);

              // Persist to ViewLog for dedup across restarts
              prisma.viewLog.create({
                data: {
                  storyId: story.id,
                  ip: viewerIp,
                  userId: viewerUserId,
                  userAgent: userAgent.slice(0, 250), // cap length to fit TEXT
                },
              }).catch((err) => {
                if (process.env.NODE_ENV !== "production") {
                  console.error(`[ViewLog] create failed for story=${story.id} ip=${viewerIp} userId=${viewerUserId}:`, err?.message);
                }
              });
            }
          } else {
            // DB says viewed recently → update in-memory cache to avoid future DB queries
            viewedRecently.set(viewKey, now);
          }
        }
      }
    }

    // Flatten storyTags for cleaner response
    const { storyTags, coverImage, coverApprovalStatus, ...rest } = story;
    res.json({
      ...rest,
      coverUrl: deriveCoverUrl(story),
      storyTagList: storyTags?.map((st: any) => st.tag) ?? [],
    });
  } catch (error) {
    console.error("Error fetching story:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
