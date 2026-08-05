import crypto from "crypto";
import { getViewTokenSecret } from "./secrets";

const VIEW_TOKEN_TTL_SECONDS = 60;

/**
 * Verify a signed view-count token and extract the storyId.
 * Returns null if the token is missing, expired, or tampered.
 *
 * Token format: `sigB64.tokenB64`
 * tokenB64 decodes to: `storyId:clientIP:timestamp`
 */
export function verifyViewToken(token: string, clientIP: string): string | null {
  const secret = getViewTokenSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [sigB64, tokenB64] = parts;

  let payload: string;
  try {
    payload = atob(tokenB64);
  } catch {
    return null;
  }

  const [storyId, ip, tsStr] = payload.split(":");
  if (!storyId || !ip || !tsStr) return null;

  // Verify IP matches the token
  if (ip !== clientIP) return null;

  // Verify timestamp is fresh
  const ts = parseInt(tsStr, 10);
  if (!Number.isFinite(ts)) return null;
  if (Math.abs(Date.now() / 1000 - ts) > VIEW_TOKEN_TTL_SECONDS) return null;

  // Verify HMAC signature
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64");

  if (!crypto.timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
    return null;
  }

  return storyId;
}
