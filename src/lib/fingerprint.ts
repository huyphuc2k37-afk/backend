/**
 * Device Fingerprinting Module
 *
 * Generates a stable device fingerprint from browser signals.
 * This fingerprint is used for anti-bot detection and view quality tracking.
 */

import crypto from "crypto";
import prisma from "./prisma";

export interface FingerprintData {
  hash: string;
  screen: string;
  timezone: string;
  language: string;
  platform: string;
  canvasHash: string;
  webglHash: string;
}

/**
 * Generate a fingerprint hash from multiple signals
 */
export function generateFingerprintHash(data: FingerprintData): string {
  const combined = [
    data.screen,
    data.timezone,
    data.language,
    data.platform,
    data.canvasHash,
    data.webglHash,
  ].join("|");

  return crypto.createHash("sha256").update(combined).digest("hex").slice(0, 32);
}

/**
 * Get or create a DeviceFingerprint record
 */
export async function getOrCreateFingerprint(
  hash: string,
  ip: string
): Promise<{ id: string; isBot: boolean; botScore: number } | null> {
  try {
    // Try to find existing fingerprint
    const existing = await prisma.deviceFingerprint.findUnique({
      where: { hash },
    });

    if (existing) {
      // Update last seen and add IP if not present
      const updatedIps = existing.ipAddresses.includes(ip)
        ? existing.ipAddresses
        : [...existing.ipAddresses, ip].slice(-50); // Keep last 50 IPs

      await prisma.deviceFingerprint.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          ipAddresses: updatedIps,
          viewCount: { increment: 1 },
        },
      });

      return {
        id: existing.id,
        isBot: existing.isBot,
        botScore: existing.botScore,
      };
    }

    // Create new fingerprint
    const fingerprint = await prisma.deviceFingerprint.create({
      data: {
        hash,
        ipAddresses: [ip],
        viewCount: 1,
        isBot: false,
        botScore: 0,
      },
    });

    return {
      id: fingerprint.id,
      isBot: fingerprint.isBot,
      botScore: fingerprint.botScore,
    };
  } catch (error) {
    console.error("[Fingerprint] Error:", error);
    return null;
  }
}

/**
 * Update fingerprint bot status
 */
export async function updateFingerprintBotStatus(
  fingerprintId: string,
  isBot: boolean,
  botScore: number
): Promise<void> {
  try {
    await prisma.deviceFingerprint.update({
      where: { id: fingerprintId },
      data: { isBot, botScore },
    });
  } catch (error) {
    console.error("[Fingerprint] Update bot status error:", error);
  }
}

/**
 * Check if fingerprint is known bot
 */
export async function isFingerprintBot(fingerprintId: string | null): Promise<boolean> {
  if (!fingerprintId) return false;

  try {
    const fingerprint = await prisma.deviceFingerprint.findUnique({
      where: { id: fingerprintId },
      select: { isBot: true },
    });
    return fingerprint?.isBot ?? false;
  } catch {
    return false;
  }
}

/**
 * Calculate quality score based on engagement signals
 */
export function calculateQualityScore(params: {
  dwellTime: number; // seconds
  scrollDepth: number; // 0-1
  chaptersRead: number;
  hasComment: boolean;
  hasBookmark: boolean;
  hasRating: boolean;
}): number {
  const { dwellTime, scrollDepth, chaptersRead, hasComment, hasBookmark, hasRating } = params;

  // Weighted quality score
  let score = 0;

  // Dwell time: 40% weight
  // 0-10s = 0, 10-30s = 0.3, 30-60s = 0.6, 60s+ = 1.0
  const dwellScore = Math.min(1, dwellTime / 60);
  score += dwellScore * 0.4;

  // Scroll depth: 30% weight
  score += scrollDepth * 0.3;

  // Additional engagement: 30% weight
  let engagementScore = 0;
  if (chaptersRead > 0) engagementScore += 0.1;
  if (chaptersRead >= 3) engagementScore += 0.1;
  if (hasComment) engagementScore += 0.3;
  if (hasBookmark) engagementScore += 0.2;
  if (hasRating) engagementScore += 0.3;
  score += Math.min(1, engagementScore) * 0.3;

  return Math.round(score * 100) / 100; // Round to 2 decimal places
}

/**
 * Validate fingerprint hash format
 */
export function isValidFingerprintHash(hash: string): boolean {
  // Must be 32 character hex string
  return /^[a-f0-9]{32}$/i.test(hash);
}

/**
 * Get IP reputation data
 */
export async function getIpReputation(ip: string): Promise<{
  viewCount: number;
  isBanned: boolean;
  fingerprintCount: number;
}> {
  try {
    const [viewCountResult, bannedResult, fingerprintCount] = await Promise.all([
      prisma.viewLog.count({
        where: { ip },
      }),
      prisma.bannedIP.findUnique({
        where: { ip },
        select: { ip: true },
      }),
      prisma.deviceFingerprint.count({
        where: { ipAddresses: { has: ip } },
      }),
    ]);

    return {
      viewCount: viewCountResult,
      isBanned: !!bannedResult,
      fingerprintCount,
    };
  } catch {
    return { viewCount: 0, isBanned: false, fingerprintCount: 0 };
  }
}

/**
 * Get view frequency (views per hour)
 */
export async function getViewFrequency(ip: string): Promise<number> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const count = await prisma.viewLog.count({
      where: {
        ip,
        createdAt: { gte: oneHourAgo },
      },
    });
    return count;
  } catch {
    return 0;
  }
}
