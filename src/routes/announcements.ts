import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

// ─── Admin middleware ────────────────────────────
async function adminRequired(req: AuthRequest, res: Response, next: NextFunction) {
  const user = await prisma.user.findUnique({
    where: { email: req.user!.email },
  });
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  (req as any).adminUser = user;
  next();
}

// ─── GET /api/announcements — public, get active announcements ──
router.get("/", async (_req: Request, res: Response) => {
  try {
    const announcements = await prisma.announcement.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, message: true, createdAt: true },
    });
    res.json(announcements);
  } catch (error) {
    console.error("Error fetching announcements:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/announcements/all — admin, get all announcements ──
router.get("/all", authRequired, adminRequired, async (_req: AuthRequest, res: Response) => {
  try {
    const announcements = await prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        createdByUser: { select: { id: true, name: true } },
      },
    });
    res.json(announcements);
  } catch (error) {
    console.error("Error fetching all announcements:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/announcements — admin, create announcement ──
router.post("/", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Nội dung thông báo không được để trống" });
    }
    if (message.length > 500) {
      return res.status(400).json({ error: "Thông báo tối đa 500 ký tự" });
    }

    const admin = (req as any).adminUser;
    const announcement = await prisma.announcement.create({
      data: {
        message: message.trim(),
        createdBy: admin.id,
      },
    });
    res.status(201).json(announcement);
  } catch (error) {
    console.error("Error creating announcement:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /api/announcements/:id — admin, toggle active ──
router.patch("/:id", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const announcement = await prisma.announcement.update({
      where: { id },
      data: { isActive: typeof isActive === "boolean" ? isActive : undefined },
    });
    res.json(announcement);
  } catch (error) {
    console.error("Error updating announcement:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/announcements/:id — admin, delete announcement ──
router.delete("/:id", authRequired, adminRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.announcement.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting announcement:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
