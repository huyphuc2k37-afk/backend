/**
 * IP extraction utilities for Express requests.
 *
 * By default, x-forwarded-for is UNTRUSTED — clients can spoof it.
 * Set TRUSTED_PROXIES to a list of IP addresses/CIDRs that are known
 * reverse proxies (e.g. Cloudflare, Vercel, nginx). Only requests
 * originating from those IPs will have their x-forwarded-for header used.
 * All other requests use req.socket.remoteAddress directly.
 *
 * Example: TRUSTED_PROXIES=1.2.3.4,10.0.0.0/8
 */

const TRUSTED_PROXIES = (process.env.TRUSTED_PROXIES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Returns true if the given IP is in the trusted proxy list. */
function isTrustedProxy(ip: string): boolean {
  if (TRUSTED_PROXIES.length === 0) return false;
  return TRUSTED_PROXIES.includes(ip);
}

/**
 * Extract the real client IP from an Express Request.
 *
 * Strategy:
 *  - If the direct connection is from a trusted proxy → use x-forwarded-for
 *  - Otherwise → use req.ip (or req.socket.remoteAddress)
 *  - Returns null when IP cannot be determined (e.g. missing socket)
 *
 * @param req Express Request object
 * @returns The client IP string, or null if unavailable
 */
export function extractClientIP(req: { ip?: string; headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string | null {
  const directIp = req.ip || req.socket?.remoteAddress || null;

  if (directIp && isTrustedProxy(directIp)) {
    const forwarded = req.headers?.["x-forwarded-for"];
    if (typeof forwarded === "string") {
      const first = forwarded.split(",")[0].trim();
      if (first) return first;
    }
  }

  // Fallback: use the direct connection IP
  return directIp ?? null;
}
