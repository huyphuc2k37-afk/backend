import { Router, Request, Response } from "express";

const router = Router();

interface PerformanceMetric {
  url: string;
  userAgent: string;
  endpoint: string;
  ttfb: number;
  fcp: number;
  lcp: number;
  fid: number;
  cls: number;
  loadTime: number;
  timestamp: string;
}

// In-memory storage for metrics (in production, use a proper metrics service)
const metricsBuffer: PerformanceMetric[] = [];
const MAX_BUFFER_SIZE = 1000;

/**
 * POST /api/metrics/performance
 * Receive client-side performance metrics
 */
router.post("/performance", async (req: Request, res: Response) => {
  try {
    const metric: PerformanceMetric = {
      ...req.body,
      timestamp: new Date().toISOString(),
    };

    // Add to buffer
    metricsBuffer.push(metric);

    // Keep buffer size limited
    if (metricsBuffer.length > MAX_BUFFER_SIZE) {
      metricsBuffer.shift();
    }

    // Log slow pages
    if (metric.lcp > 2500 || metric.loadTime > 5000) {
      console.warn(`[Metrics] Slow page: ${metric.url} LCP=${metric.lcp}ms Load=${metric.loadTime}ms`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[Metrics] Error recording metric:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/metrics/summary
 * Get summary of recent metrics (admin only in production)
 */
router.get("/summary", async (_req: Request, res: Response) => {
  try {
    if (metricsBuffer.length === 0) {
      return res.json({
        count: 0,
        average: { ttfb: 0, fcp: 0, lcp: 0, loadTime: 0 },
        p95: { ttfb: 0, fcp: 0, lcp: 0, loadTime: 0 },
      });
    }

    const latestMetrics = metricsBuffer.slice(-100); // Last 100 metrics

    const avg = {
      ttfb: average(latestMetrics.map((m) => m.ttfb)),
      fcp: average(latestMetrics.map((m) => m.fcp)),
      lcp: average(latestMetrics.map((m) => m.lcp)),
      loadTime: average(latestMetrics.map((m) => m.loadTime)),
    };

    const p95 = {
      ttfb: percentile(latestMetrics.map((m) => m.ttfb), 95),
      fcp: percentile(latestMetrics.map((m) => m.fcp), 95),
      lcp: percentile(latestMetrics.map((m) => m.lcp), 95),
      loadTime: percentile(latestMetrics.map((m) => m.loadTime), 95),
    };

    res.json({
      count: latestMetrics.length,
      average: avg,
      p95,
      thresholds: {
        good: { ttfb: 800, fcp: 1800, lcp: 2500, loadTime: 3000 },
        needsImprovement: { ttfb: 1800, fcp: 3000, lcp: 4000, loadTime: 5000 },
      },
    });
  } catch (error) {
    console.error("[Metrics] Error getting summary:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, index)]);
}

export default router;
