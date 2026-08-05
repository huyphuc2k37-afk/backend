import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

export interface ReadingPreferences {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  theme: "light" | "dark" | "sepia";
}

// Default reading preferences
export const DEFAULT_READING_PREFERENCES: ReadingPreferences = {
  fontFamily: "serif",
  fontSize: 18,
  lineHeight: 1.8,
  theme: "light",
};

// GET /api/users/preferences — get user reading preferences
router.get("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { readingPreferences: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let preferences: ReadingPreferences;
    if (user.readingPreferences) {
      try {
        preferences = { ...DEFAULT_READING_PREFERENCES, ...JSON.parse(user.readingPreferences) };
      } catch {
        preferences = DEFAULT_READING_PREFERENCES;
      }
    } else {
      preferences = DEFAULT_READING_PREFERENCES;
    }

    res.json({ preferences });
  } catch (error) {
    console.error("Error fetching reading preferences:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/users/preferences — update reading preferences
router.put("/", authRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { preferences } = req.body;

    if (!preferences || typeof preferences !== "object") {
      return res.status(400).json({ error: "Invalid preferences data" });
    }

    const currentUser = await prisma.user.findUnique({
      where: { email: req.user!.email },
      select: { readingPreferences: true },
    });

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Merge with current preferences
    let currentPrefs: ReadingPreferences;
    try {
      currentPrefs = currentUser.readingPreferences
        ? { ...DEFAULT_READING_PREFERENCES, ...JSON.parse(currentUser.readingPreferences) }
        : DEFAULT_READING_PREFERENCES;
    } catch {
      currentPrefs = DEFAULT_READING_PREFERENCES;
    }

    // Validate and merge new preferences
    const updatedPrefs: ReadingPreferences = {
      fontFamily: typeof preferences.fontFamily === "string"
        ? preferences.fontFamily
        : currentPrefs.fontFamily,
      fontSize: typeof preferences.fontSize === "number"
        ? Math.min(24, Math.max(14, Math.round(preferences.fontSize)))
        : currentPrefs.fontSize,
      lineHeight: typeof preferences.lineHeight === "number"
        ? Math.min(2.0, Math.max(1.4, preferences.lineHeight))
        : currentPrefs.lineHeight,
      theme: ["light", "dark", "sepia"].includes(preferences.theme)
        ? preferences.theme
        : currentPrefs.theme,
    };

    await prisma.user.update({
      where: { email: req.user!.email },
      data: { readingPreferences: JSON.stringify(updatedPrefs) },
    });

    res.json({ preferences: updatedPrefs });
  } catch (error) {
    console.error("Error updating reading preferences:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
