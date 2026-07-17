import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./auth";

/**
 * Maintenance Mode middleware
 *
 * When MAINTENANCE_MODE=true, all user-facing API routes return 503 so the
 * frontend can show the "Đang bảo trì" page. The following requests are
 * ALWAYS allowed through:
 *
 *   - /api/health                       (so the frontend can probe status)
 *   - /api/maintenance/status           (frontend wrapper polls this)
 *   - /api/admin/** and /api/mod/**     (admin/mod can still work)
 *   - /api/auth/login, /api/auth/register, /api/auth/verify
 *                                       (so admin can re-authenticate)
 *   - Requests from MAINTENANCE_ALLOWED_IPS
 *   - Authenticated admin/moderator users (by email allow-list)
 *
 * Recommended values for .env:
 *
 *   MAINTENANCE_MODE=true
 *   MAINTENANCE_MESSAGE="Hệ thống đang được bảo trì. Vui lòng quay lại sau."
 *   MAINTENANCE_ETA="2026-07-18T03:00:00+07:00"
 *   MAINTENANCE_RETRY_AFTER=3600
 *   MAINTENANCE_ALLOWED_IPS=127.0.0.1,::1
 *   MAINTENANCE_ADMIN_EMAILS=admin@vstory.vn
 */

/**
 * Extract the client IP without depending on the (optional) lib/ip helper.
 * Trusts req.ip which is set by express's `trust proxy` config in index.ts.
 */
function extractClientIP(req: Request): string {
  const ip = (req.ip || "").toString().split(",")[0].trim();
  return ip;
}

function getMaintenanceInfo(): {
  active: boolean;
  message: string;
  eta: string;
  retryAfter: number;
} {
  // Read env at request time so toggling MAINTENANCE_MODE via the Render
  // Dashboard and triggering a redeploy picks up the new value without
  // any process restart hack.
  const active = process.env.MAINTENANCE_MODE === "true";
  const message =
    process.env.MAINTENANCE_MESSAGE ||
    "Hệ thống đang được bảo trì. Vui lòng quay lại sau.";
  const eta = process.env.MAINTENANCE_ETA || "";
  const retryAfter = Number(process.env.MAINTENANCE_RETRY_AFTER || 3600);
  return { active, message, eta, retryAfter };
}

export function isMaintenanceMode(): boolean {
  return process.env.MAINTENANCE_MODE === "true";
}

const ALLOWED_IPS = () =>
  (process.env.MAINTENANCE_ALLOWED_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const ADMIN_EMAILS = () =>
  (process.env.MAINTENANCE_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

// Paths that always pass through, even in maintenance mode.
const ALWAYS_ALLOWED_PREFIXES = [
  "/api/admin",
  "/api/mod",
];

const ALWAYS_ALLOWED_EXACT = new Set<string>([
  "/api/health",
  "/api/maintenance/status",
  "/api/maintenance",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/verify",
  "/api/auth/resend",
  "/api/auth/session",
  "/api/client-ip",
  "/api/_env/maintenance",
]);

function isAlwaysAllowed(req: Request): boolean {
  if (ALWAYS_ALLOWED_EXACT.has(req.path)) return true;
  return ALWAYS_ALLOWED_PREFIXES.some((p) => req.path.startsWith(p));
}

function isIpAllowed(req: Request): boolean {
  const ips = ALLOWED_IPS();
  if (ips.length === 0) return false;
  const ip = extractClientIP(req);
  if (!ip) return false;
  return ips.includes(ip);
}

function isAdminRequest(req: Request): boolean {
  const authReq = req as AuthRequest;
  const email = authReq.user?.email?.toLowerCase();
  if (!email) return false;
  return ADMIN_EMAILS().includes(email);
}

function buildMaintenanceResponse(res: Response) {
  const info = getMaintenanceInfo();
  if (info.retryAfter > 0) res.setHeader("Retry-After", String(info.retryAfter));
  res.setHeader("X-Maintenance-Mode", "true");
  res.status(503).json({
    error: "MAINTENANCE",
    message: info.message,
    eta: info.eta || null,
    retryAfter: info.retryAfter,
    timestamp: new Date().toISOString(),
  });
}

export function maintenanceMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isMaintenanceMode()) return next();

  // Allowed by path
  if (isAlwaysAllowed(req)) return next();

  // Allowed by IP
  if (isIpAllowed(req)) return next();

  // Allowed by authenticated admin/mod email
  if (isAdminRequest(req)) return next();

  // Block everything else with a structured 503 response
  buildMaintenanceResponse(res);
}

/**
 * Optional read-only middleware that exposes the maintenance status to the
 * frontend. Returns 200 whether or not maintenance mode is active so the
 * frontend can poll cheaply without rate-limit issues.
 */
export function maintenanceStatusHandler(_req: Request, res: Response) {
  res.json(getMaintenanceInfo());
}
