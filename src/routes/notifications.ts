import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ─── Auto-cleanup notifications older than 3 days ──
const NOTIFICATION_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

async function cleanupOldNotifications() {
  try {
    const cutoff = new Date(Date.now() - NOTIFICATION_TTL_MS);
    const result = await prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      console.log(`🧹 Cleaned up ${result.count} old notifications (>3 days)`);
    }
  } catch (error) {
    console.error("Error cleaning up old notifications:", error);
  }
}

// Run cleanup every 6 hours
setInterval(cleanupOldNotifications, 6 * 60 * 60 * 1000);
// Run once on startup (after 10s delay)
setTimeout(cleanupOldNotifications, 10_000);

// ─── GET /api/notifications — danh sách thông báo của user ──
router.get("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const limitRaw = req.query.limit as string | undefined;
    const limit = Math.min(Math.max(parseInt(limitRaw || "10", 10) || 10, 1), 50);

    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Only fetch notifications within 3 days
    const cutoff = new Date(Date.now() - NOTIFICATION_TTL_MS);

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id, createdAt: { gte: cutoff } },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.notification.count({
        where: { userId: user.id, isRead: false, createdAt: { gte: cutoff } },
      }),
    ]);

    res.json({ notifications, unreadCount });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/notifications/read-all — đánh dấu tất cả đã đọc ──
router.put("/read-all", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const result = await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    res.json({ marked: result.count });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/notifications/:id/read — đánh dấu đã đọc ──
router.put("/:id/read", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const existing = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== user.id) {
      return res.status(404).json({ error: "Notification not found" });
    }

    const updated = await prisma.notification.update({
      where: { id: existing.id },
      data: { isRead: true, readAt: new Date() },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
