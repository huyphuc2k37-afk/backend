import "dotenv/config";

// Early startup logging - to Railway stderr/stdout
console.log("=".repeat(60));
console.log("[BOOT] Starting VStory Backend...");
console.log(`[BOOT] Node version: ${process.version}`);
console.log(`[BOOT] PORT env: ${process.env.PORT || "NOT SET"}`);
console.log(`[BOOT] NODE_ENV: ${process.env.NODE_ENV || "NOT SET"}`);
console.log(`[BOOT] DATABASE_URL present: ${!!process.env.DATABASE_URL}`);
console.log(`[BOOT] Timestamp: ${new Date().toISOString()}`);
console.log("=".repeat(60));

// Catch unhandled errors early
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err);
  console.error("[FATAL] Stack:", err.stack);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled Rejection:", reason);
});

import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "path";

// ??? Sentry Error Monitoring ?????????????????????
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1, // 10% of transactions
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      return event;
    },
  });
  console.log("Sentry error monitoring enabled");
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
import adsRouter from "./routes/ads";
import affiliateRouter from "./routes/affiliate";
import giftsRouter from "./routes/gifts";
import fanClubRouter from "./routes/fanClub";
import recommendationsRouter from "./routes/recommendations";
import paidSuggestionsRouter from "./routes/paidSuggestions";
import authorAdsRouter from "./routes/authorAds";
import adminBadgesRouter from "./routes/adminBadges";
import authorLevelsRouter from "./routes/authorLevels";
import revenueDashboardRouter from "./routes/revenueDashboard";
import userPreferencesRouter from "./routes/userPreferences";
import viewQualityRouter from "./routes/viewQuality";
import metricsRouter from "./routes/metrics";
import viewStatsRouter from "./routes/viewStats";
import readHistoryRouter from "./routes/readHistory";
import { startTelegramPolling } from "./lib/telegram";
import {
  maintenanceMiddleware,
  maintenanceStatusHandler,
} from "./middleware/maintenance";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.disable("x-powered-by");
app.set("trust proxy", 1); // Trust only first proxy hop

// ??? Middleware ???????????????????????????????????
import { requestId, requestLogger } from "./middleware/requestId";
import { errorHandler, notFoundHandler } from "./lib/errors";

const normalizeOrigin = (origin: string): string => {
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
  } catch {}
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
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(compression());
app.use(requestId());
app.use(requestLogger());

// Serve locally-stored covers (downloaded CDN mirrors) at /storage/...
// This lets the frontend reference local files instead of remote CDNs.
const STORAGE_ROOT = path.resolve(__dirname, "..", "..", "local-data", "storage");
app.use(
  "/storage",
  express.static(STORAGE_ROOT, {
    fallthrough: false,
    maxAge: "30d",
    immutable: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".webp")) res.set("Content-Type", "image/webp");
      else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) res.set("Content-Type", "image/jpeg");
      else if (filePath.endsWith(".png")) res.set("Content-Type", "image/png");
    },
  })
);

let lastRequestTime = Date.now();
app.use((_req, _res, next) => {
  lastRequestTime = Date.now();
  next();
});
app.use(express.json({ limit: "5mb" }));

// Maintenance Mode middleware - read env at request time
app.use(maintenanceMiddleware);

// Quick health probe endpoint with detailed status
app.get("/api/health", async (_req, res) => {
  const memory = process.memoryUsage();
  let dbStatus = "unknown";
  try {
    const prismaModule = await import("./lib/prisma");
    const client = (prismaModule as any).prisma ?? (prismaModule as any).default;
    if (client && typeof client.$queryRaw === "function") {
      await client.$queryRaw`SELECT 1`;
      dbStatus = "ok";
    } else {
      dbStatus = "unavailable";
    }
  } catch {
    dbStatus = "error";
  }
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: dbStatus,
    memory: {
      rss: Math.round(memory.rss / 1024 / 1024),
      heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
    },
    version: process.env.npm_package_version ?? "1.0.0",
  });
});

// Maintenance status endpoint (always available)
app.get("/api/maintenance/status", maintenanceStatusHandler);

// Debug env visibility (always available, returns minimal info)
app.get("/api/_env/maintenance", (_req, res) => {
  res.json({
    MAINTENANCE_MODE_raw: process.env.MAINTENANCE_MODE ?? null,
    MAINTENANCE_MODE_parsed: process.env.MAINTENANCE_MODE === "true",
    isMaintenanceMode: process.env.MAINTENANCE_MODE === "true",
    NODE_ENV: process.env.NODE_ENV ?? null,
  });
});

// Rate Limiting
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
  validate: { trustProxy: false },
});
app.use("/api", generalLimiter);

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth requests" },
  validate: { trustProxy: false },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/resend", authLimiter);
app.use("/api/auth/verify", authLimiter);

// Routes
const largeBodyParser = express.json({ limit: "10mb" });
app.use("/api/manage", largeBodyParser, storyManageRouter);

app.use("/api/stories", storiesRouter);
app.use("/api/stories", storyDetailRouter);
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
app.use("/api/stories", interactionsRouter);
app.use("/api/auth", authRoutes);
app.use("/api/sitemap", sitemapRouter);
app.use("/api/mod", moderationRouter);
app.use("/api/announcements", announcementsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/tags", tagsRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/quests", questsRouter);
app.use("/api/ads", adsRouter);
app.use("/api/affiliate", affiliateRouter);
app.use("/api/gifts", giftsRouter);
app.use("/api/fanclub", fanClubRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/suggestions", paidSuggestionsRouter);
app.use("/api/author/ads", authorAdsRouter);
app.use("/api/admin/badges", adminBadgesRouter);
app.use("/api/levels", authorLevelsRouter);
app.use("/api/revenue/dashboard", revenueDashboardRouter);
app.use("/api/user-preferences", userPreferencesRouter);
app.use("/api/stats", viewQualityRouter);
app.use("/api/metrics", metricsRouter);
app.use("/api/views", viewStatsRouter);
app.use("/api/read-history", readHistoryRouter);

// Centralized 404 + error handlers
app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.message?.startsWith("CORS blocked")) {
    return res.status(403).json({ error: "Origin not allowed", code: "CORS_BLOCKED" });
  }
  if ((err as any).type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large", code: "PAYLOAD_TOO_LARGE" });
  }
  return errorHandler(err, _req, res, next);
});
app.use(errorHandler);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`VStory Backend running at http://0.0.0.0:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  startTelegramPolling();

  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_URL) {
    setInterval(() => {
      if (Date.now() - lastRequestTime > 13 * 60 * 1000) {
        fetch(`${RENDER_URL}/api/health`).catch(() => {});
      }
    }, 60 * 1000);
  }
});

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
