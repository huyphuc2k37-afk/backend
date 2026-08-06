/**
 * Cover image helpers shared across routes.
 *
 * Returns the URL the frontend should use to render the cover, in priority order:
 *   1. SVG placeholder (inline data URI) — for stories without a real cover
 *   2. Cloudinary URL → local mirror fallback (so the frontend doesn't depend on the CDN)
 *   3. Base64 webp/png/jpeg inline data URI — for legacy stories that haven't been migrated yet
 *   4. Anything else (e.g. Supabase, generic http(s)) → /api/stories/:id/cover endpoint
 *
 * Returns null when:
 *   - story.coverImage is empty
 *   - cover is rejected (coverApprovalStatus === "rejected")
 *   - story is not yet approved (neither approvalStatus nor coverApprovalStatus === "approved")
 */

import { getLocalCoverUrl } from "./localCovers";

export interface StoryCoverShape {
  id?: string | null;
  coverImage?: string | null;
  coverApprovalStatus?: string | null;
  approvalStatus?: string | null;
}

/** Whether the cover should be displayed at all. */
export function isCoverVisible(story: StoryCoverShape): boolean {
  if (!story.coverImage) return false;
  if (story.coverApprovalStatus === "rejected") return false;
  if (story.approvalStatus !== "approved" && story.coverApprovalStatus !== "approved") return false;
  return true;
}

/**
 * Derive a direct cover URL from a Story record (null if hidden).
 * See module-level comment for the priority order.
 */
export function deriveCoverUrl(story: StoryCoverShape): string | null {
  if (!isCoverVisible(story)) return null;
  const img = story.coverImage!;

  // 1. SVG placeholder (already a data URI) — serve inline so the browser
  //    renders it directly without an extra request.
  if (img.startsWith("data:image/svg")) {
    return img;
  }
  // 1b. URL-encoded SVG: try decoding (covers %3Csvg legacy form).
  if (img.includes("%3Csvg") || img.includes("%3Csvg")) {
    try {
      const decoded = decodeURIComponent(img);
      if (decoded.startsWith("data:image/svg") || decoded.startsWith("<svg")) {
        return decoded;
      }
    } catch {
      /* fall through */
    }
  }
  // 1c. Raw SVG with/without XML declaration — wrap as data URI.
  if (img.startsWith("<?xml") || img.startsWith("<svg")) {
    return "data:image/svg+xml;charset=UTF-8," + img;
  }

  // 2. Cloudinary URL → prefer the local mirror (faster, no CDN dependency).
  //    Fall back to the original Cloudinary URL when no local file exists.
  if (img.includes("cloudinary.com") || img.includes("res.cloudinary")) {
    const local = story.id ? getLocalCoverUrl(story.id) : null;
    if (local) return local;
    return img;
  }

  // 3. data:image/*;base64 (webp/png/jpeg) — serve as inline data URL too.
  if (img.startsWith("data:image/")) {
    return img;
  }

  // 4. Known healthy CDN — return direct URL so the browser doesn't proxy
  //    through the backend. This avoids e.g. Supabase HTTP 402 quota issues.
  //    We recognize: res.cloudinary.com (already handled above), imgur, unsplash,
  //    googleusercontent, github raw, generic https on a known image host.
  //    Supabase (.supabase.co) is intentionally excluded because it sometimes
  //    returns 402 Payment Required when the project hits egress quota.
  if (/^https?:\/\//i.test(img)) {
    const isSupabase = /\.supabase\.co\b/i.test(img);
    if (!isSupabase) {
      return img;
    }
  }

  // 5. Anything else (Supabase or unknown) — stream through the backend.
  if (!story.id) return null;
  return `/api/stories/${story.id}/cover`;
}