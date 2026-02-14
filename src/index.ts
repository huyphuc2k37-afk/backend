import "dotenv/config";
import express from "express";
import cors from "cors";
import compression from "compression";

// Import routes
import storiesRouter from "./routes/stories";
import storyDetailRouter from "./routes/storyDetail";
import chaptersRouter from "./routes/chapters";
import bookmarksRouter from "./routes/bookmarks";
import rankingRouter from "./routes/ranking";
import profileRouter from "./routes/profile";
import commentsRouter from "./routes/comments";
import storyManageRouter from "./routes/storyManage";
import walletRouter from "./routes/wallet";
import revenueRouter from "./routes/revenue";
import adminRouter from "./routes/admin";
import notificationsRouter from "./routes/notifications";
import authorsRouter from "./routes/authors";
import followsRouter from "./routes/follows";
import authRoutes from "./routes/authRoutes";
import interactionsRouter from "./routes/interactions";
import sitemapRouter from "./routes/sitemap";
import moderationRouter from "./routes/moderation";
import announcementsRouter from "./routes/announcements";
import { startTelegramPolling } from "./lib/telegram";

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ───────────────────────────────────
const normalizeOrigin = (origin: string): string => {
  // Normalize for reliable comparisons:
  // - trim whitespace
  // - strip trailing slashes
  // - lowercase hostname
  // - keep protocol + host (+ port if present)
  const trimmed = origin.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();
    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol}//${hostname}${port}`;
  } catch {
    return trimmed;
  }
};

const addWwwApexPair = (origin: string, set: Set<string>) => {
  // If env only includes apex or www, allow the other as well.
  // Keeps CORS strict while handling common domain setups.
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    const port = url.port ? `:${url.port}` : "";
    const base = `${url.protocol}//`;

    if (hostname.startsWith("www.")) {
      set.add(`${base}${hostname.slice(4)}${port}`);
    } else {
      set.add(`${base}www.${hostname}${port}`);
    }
  } catch {
    // ignore
  }
};

const parseAllowedOrigins = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
};

const allowedOrigins = new Set<string>();
allowedOrigins.add("http://localhost:3000");

if (process.env.FRONTEND_URL) {
  const frontendOrigin = normalizeOrigin(process.env.FRONTEND_URL);
  allowedOrigins.add(frontendOrigin);
  addWwwApexPair(frontendOrigin, allowedOrigins);
}

for (const origin of parseAllowedOrigins(process.env.ALLOWED_ORIGINS)) {
  allowedOrigins.add(origin);
  addWwwApexPair(origin, allowedOrigins);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeOrigin(origin);
      if (allowedOrigins.has(normalizedOrigin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${normalizedOrigin}`));
    },
    credentials: true,
  })
);
app.use(compression());
app.use(express.json({ limit: "10mb" }));

// ─── Health check ────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Routes ──────────────────────────────────────
app.use("/api/stories", storiesRouter);
app.use("/api/stories", storyDetailRouter);  // handles /api/stories/:slug
app.use("/api/chapters", chaptersRouter);
app.use("/api/bookmarks", bookmarksRouter);
app.use("/api/ranking", rankingRouter);
app.use("/api/profile", profileRouter);
app.use("/api/comments", commentsRouter);
app.use("/api/manage", storyManageRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/revenue", revenueRouter);
app.use("/api/admin", adminRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/authors", authorsRouter);
app.use("/api/follows", followsRouter);
app.use("/api/stories", interactionsRouter); // handles /api/stories/:id/like, /rate
app.use("/api/auth", authRoutes);
app.use("/api/sitemap", sitemapRouter);
app.use("/api/mod", moderationRouter);
app.use("/api/announcements", announcementsRouter);

// ─── 404 handler ─────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─── Start server ────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 VStory Backend running at http://localhost:${PORT}`);
  console.log(`📖 API docs: http://localhost:${PORT}/api/health`);
  startTelegramPolling();
});

export default app;
