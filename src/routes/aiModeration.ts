import { Router, Response } from "express";
import { authRequired } from "../middleware/auth";
import { AuthRequest } from "../middleware/auth";
import {
  analyzeContent,
  analyzeCover,
  classifyViolation,
  calculateConfidence,
  getViolationTypes,
  requiresImmediateReview,
  type ModerationResult,
  type CoverAnalysisResult,
  type ViolationType,
} from "../lib/aiModeration";

const router = Router();

// ─── Moderator middleware ───────────────────────
async function modRequired(req: AuthRequest, res: Response, next: Function) {
  const prisma = (await import("../lib/prisma")).default;
  const user = await prisma.user.findUnique({
    where: { email: req.user!.email },
  });
  if (!user || (user.role !== "moderator" && user.role !== "admin")) {
    return res.status(403).json({ error: "Moderator access required" });
  }
  req.modUser = user;
  next();
}

// ─── POST /api/mod/ai/analyze-content — phân tích nội dung ──
router.post("/analyze-content", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { content, type = "story" } = req.body;

    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "Content is required and must be a string" });
    }

    if (content.length > 100000) {
      return res.status(400).json({ error: "Content exceeds maximum length of 100,000 characters" });
    }

    const result = analyzeContent(content);

    res.json({
      success: true,
      type,
      result: {
        passed: result.passed,
        confidence: result.confidence,
        violations: result.violations,
        categories: result.categories,
        classification: result.classification,
        flags: result.flags,
        message: result.message,
        requiresImmediateReview: requiresImmediateReview(result),
      },
    });
  } catch (error) {
    console.error("Error analyzing content:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/mod/ai/analyze-cover — phân tích ảnh bìa ──
router.post("/analyze-cover", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { imageUrl, storyId } = req.body;

    if (!imageUrl || typeof imageUrl !== "string") {
      return res.status(400).json({ error: "Image URL is required and must be a string" });
    }

    const result = analyzeCover(imageUrl);

    res.json({
      success: true,
      storyId: storyId || null,
      result: {
        passed: result.passed,
        confidence: result.confidence,
        issues: result.issues,
        safeIndicators: result.safeIndicators,
        message: result.message,
      },
    });
  } catch (error) {
    console.error("Error analyzing cover:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/mod/ai/classify-violation — phân loại vi phạm ──
router.post("/classify-violation", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { content } = req.body;

    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "Content is required and must be a string" });
    }

    const classification = classifyViolation(content);

    res.json({
      success: true,
      classification: {
        type: classification.type,
        severity: classification.severity,
        confidence: classification.confidence,
        details: classification.details,
      },
    });
  } catch (error) {
    console.error("Error classifying violation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/mod/ai/violation-types — danh sách loại vi phạm ──
router.get("/violation-types", authRequired, modRequired, async (_req: AuthRequest, res: Response) => {
  try {
    const types = getViolationTypes();

    res.json({
      success: true,
      violationTypes: types.map((v) => ({
        code: v.code,
        label: v.label,
        severity: v.severity,
        description: v.description,
      })),
    });
  } catch (error) {
    console.error("Error fetching violation types:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/mod/ai/batch-analyze — phân tích hàng loạt ──
router.post("/batch-analyze", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { items, type = "story" } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items array is required and must not be empty" });
    }

    if (items.length > 50) {
      return res.status(400).json({ error: "Maximum 50 items per batch request" });
    }

    const results = items.map((item: string, index: number) => {
      const result = analyzeContent(item);
      return {
        index,
        content: item.substring(0, 100) + (item.length > 100 ? "..." : ""),
        passed: result.passed,
        confidence: result.confidence,
        flags: result.flags,
        requiresReview: requiresImmediateReview(result),
      };
    });

    const passed = results.filter((r: { passed: boolean }) => r.passed).length;
    const failed = results.filter((r: { passed: boolean }) => !r.passed).length;
    const needsReview = results.filter((r: { requiresReview: boolean }) => r.requiresReview).length;

    res.json({
      success: true,
      type,
      summary: {
        total: items.length,
        passed,
        failed,
        needsReview,
        passRate: Math.round((passed / items.length) * 100),
      },
      results,
    });
  } catch (error) {
    console.error("Error batch analyzing:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/mod/ai/calculate-confidence — tính điểm tin cậy ──
router.post("/calculate-confidence", authRequired, modRequired, async (req: AuthRequest, res: Response) => {
  try {
    const { passed, violationCount = 0, uniqueCategories = 0 } = req.body;

    if (typeof passed !== "boolean") {
      return res.status(400).json({ error: "Passed field is required and must be boolean" });
    }

    const confidence = calculateConfidence({
      passed,
      violationCount: typeof violationCount === "number" ? violationCount : 0,
      uniqueCategories: typeof uniqueCategories === "number" ? uniqueCategories : 0,
    });

    res.json({
      success: true,
      confidence,
      interpretation: getConfidenceInterpretation(confidence),
    });
  } catch (error) {
    console.error("Error calculating confidence:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/mod/ai/stats — thống kê AI moderation ──
router.get("/stats", authRequired, modRequired, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      stats: {
        features: {
          contentAnalysis: true,
          coverAnalysis: true,
          violationClassification: true,
          batchProcessing: true,
          confidenceScoring: true,
        },
        supportedCategories: [
          "profanity",
          "adult",
          "copyrighted",
          "spam",
          "violence",
          "hate",
        ],
        violationTypesCount: getViolationTypes().length,
      },
    });
  } catch (error) {
    console.error("Error fetching AI stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Helper function ───────────────────────
function getConfidenceInterpretation(confidence: number): {
  level: string;
  description: string;
} {
  if (confidence >= 0.9) {
    return {
      level: "very_high",
      description: "Very high confidence - result is highly reliable",
    };
  } else if (confidence >= 0.75) {
    return {
      level: "high",
      description: "High confidence - result is likely reliable",
    };
  } else if (confidence >= 0.5) {
    return {
      level: "medium",
      description: "Medium confidence - result should be reviewed",
    };
  } else if (confidence >= 0.25) {
    return {
      level: "low",
      description: "Low confidence - result requires manual review",
    };
  } else {
    return {
      level: "very_low",
      description: "Very low confidence - result is uncertain",
    };
  }
}

export default router;
