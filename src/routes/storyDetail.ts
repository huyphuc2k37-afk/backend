import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { cached, SHORT_TTL, invalidateCache } from "../lib/cache";

const router = Router();

/** Derive a direct cover URL from a Story record */
function deriveCoverUrl(story: { coverImage?: string | null; coverApprovalStatus?: string; approvalStatus?: string }): string | null {
  if (!story.coverImage) return null;
  if (story.coverApprovalStatus === "rejected") return null;
  if (story.approvalStatus !== "approved" && story.coverApprovalStatus !== "approved") return null;
  if (story.coverImage.startsWith("http://") || story.coverImage.startsWith("https://")) {
    return story.coverImage;
  }
  return null;
}

// ─── View Earning Config ─────────────────────────
const XU_PER_VIEW = 2; // xu tác giả nhận cho mỗi unique view

// ─── In-memory view buffer for batch updates ────
const viewBuffer = new Map<string, number>(); // storyId → count
const viewedRecently = new Map<string, number>(); // "ip:slug" → timestamp (fast-path cache)
const VIEW_COOLDOWN = 60 * 60 * 1000; // 1 view per IP per story per hour
const MAX_VIEW_MAP_SIZE = 50_000;
const FLUSH_INTERVAL = 5 * 60 * 1000; // flush every 5 minutes
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
  for (const [storyId, count] of entries) {
    try {
      await prisma.story.update({
        where: { id: storyId },
        data: { views: { increment: count } },
      });
    } catch (err) {
      // Story might have been deleted
    }
  }
  invalidateCache("ranking:*");
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

// GET /api/stories/:slug — get single story detail
router.get("/:slug", async (req: Request, res: Response) => {
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
            where: { approvalStatus: "approved" },
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

      // Skip banned IPs entirely
      if (!bannedIPs.has(viewerIp) && viewerIp !== "unknown") {
        const viewKey = `${viewerIp}:${slug}`;
        const lastViewed = viewedRecently.get(viewKey);
        const now = Date.now();

        // Fast-path: in-memory cache says recently viewed → skip
        if (!lastViewed || now - lastViewed > VIEW_COOLDOWN) {
          // Persistent dedup: check ViewLog in DB (survives restarts)
          const oneHourAgo = new Date(now - VIEW_COOLDOWN);
          const recentDbView = await prisma.viewLog.findFirst({
            where: { ip: viewerIp, storyId: story.id, createdAt: { gte: oneHourAgo } },
            select: { id: true },
          });

          if (!recentDbView) {
            // Daily cap: max N unique story views per IP per day
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const dailyCount = await prisma.viewLog.count({
              where: { ip: viewerIp, createdAt: { gte: todayStart } },
            });

            if (dailyCount < DAILY_VIEW_CAP_PER_IP) {
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
                data: { storyId: story.id, ip: viewerIp },
              }).catch(() => {});
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
