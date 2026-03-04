import "dotenv/config";
import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

// ─── Sentry Error Monitoring ─────────────────────
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1, // 10% of transactions
    beforeSend(event) {
      // Strip sensitive data
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      return event;
    },
  });
  console.log("🔍 Sentry error monitoring enabled");
}

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
import categoriesRouter from "./routes/categories";
import tagsRouter from "./routes/tags";
import messagesRouter from "./routes/messages";
import questsRouter from "./routes/quests";
import { startTelegramPolling } from "./lib/telegram";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.disable("x-powered-by");
app.set("trust proxy", true); // Required: Render/Vercel are reverse proxies — get real user IP from X-Forwarded-For

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
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }, // allow images to be loaded from frontend (different origin)
  })
);
app.use(compression());
app.use(express.json({ limit: "200kb" }));

// ─── Rate Limiting ───────────────────────────────
// General: 200 requests per minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Quá nhiều yêu cầu, vui lòng thử lại sau" },
});
app.use("/api", generalLimiter);

// Strict: 10 requests per minute for auth endpoints (login, register, resend)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Quá nhiều yêu cầu đăng nhập/đăng ký, vui lòng thử lại sau 1 phút" },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/resend", authLimiter);
app.use("/api/auth/verify", authLimiter);

// Very strict: max 3 registrations per hour per IP (anti-spam)
const registerSpamLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn đã đăng ký quá nhiều tài khoản. Vui lòng thử lại sau 1 giờ." },
});
app.use("/api/auth/register", registerSpamLimiter);

// Write: 30 requests per minute for write operations
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Quá nhiều yêu cầu, vui lòng thử lại sau" },
});
app.use("/api/comments", writeLimiter);
app.use("/api/wallet", writeLimiter);

// ─── Health check ────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Routes ──────────────────────────────────────
// Story/chapter management needs larger body for content
const largeBodyParser = express.json({ limit: "10mb" });
app.use("/api/manage", largeBodyParser, storyManageRouter);

app.use("/api/stories", storiesRouter);
app.use("/api/stories", storyDetailRouter);  // handles /api/stories/:slug
app.use("/api/chapters", chaptersRouter);
app.use("/api/bookmarks", bookmarksRouter);
app.use("/api/ranking", rankingRouter);
app.use("/api/profile", profileRouter);
app.use("/api/comments", commentsRouter);
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
app.use("/api/categories", categoriesRouter);
app.use("/api/tags", tagsRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/quests", questsRouter);

// ─── 404 handler ─────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─── Global error handler ────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.message?.startsWith("CORS blocked")) {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  // Report to Sentry
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start server ────────────────────────────────
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 VStory Backend running at http://0.0.0.0:${PORT}`);
  console.log(`📖 API docs: http://localhost:${PORT}/api/health`);
  startTelegramPolling();
});

// ─── Graceful shutdown ───────────────────────────
import { stopTelegramPolling } from "./lib/telegram";
const shutdown = () => {
  console.log("Shutting down gracefully...");
  stopTelegramPolling();
  server.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default app;
