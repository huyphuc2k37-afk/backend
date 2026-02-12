import "dotenv/config";
import express from "express";
import cors from "cors";

// Import routes
import storiesRouter from "./routes/stories";
import storyDetailRouter from "./routes/storyDetail";
import chaptersRouter from "./routes/chapters";
import bookmarksRouter from "./routes/bookmarks";
import rankingRouter from "./routes/ranking";
import profileRouter from "./routes/profile";
import commentsRouter from "./routes/comments";
import storyManageRouter from "./routes/storyManage";

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ───────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(express.json());

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

// ─── 404 handler ─────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─── Start server ────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 VStory Backend running at http://localhost:${PORT}`);
  console.log(`📖 API docs: http://localhost:${PORT}/api/health`);
});

export default app;
