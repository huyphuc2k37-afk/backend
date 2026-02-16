import { createClient, SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

/**
 * Supabase Storage helper for cover images.
 *
 * Requires env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (NOT the anon key)
 *
 * Supabase dashboard setup:
 *   1. Create a public bucket called "covers"
 *   2. Allow public read access (no RLS on read)
 *
 * If SUPABASE_SERVICE_ROLE_KEY is not set, all functions
 * return null so the caller can fall back to base64.
 */

const BUCKET = "covers";

let _client: SupabaseClient | null = null;

function getStorageClient(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) return null;

  _client = createClient(url, serviceKey);
  return _client;
}

/** Check whether cloud storage is configured */
export function isStorageEnabled(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Upload a base64 data-URI to Supabase Storage.
 * Returns the public URL on success, or null if storage is disabled / upload fails.
 */
export async function uploadCoverImage(
  dataUri: string,
  storyId: string
): Promise<string | null> {
  const client = getStorageClient();
  if (!client) return null;

  const match = dataUri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) return null;

  const [, mimeType, base64Data] = match;
  const buffer = Buffer.from(base64Data, "base64");

  // Determine extension from MIME
  const ext =
    mimeType === "image/webp"
      ? "webp"
      : mimeType === "image/png"
        ? "png"
        : mimeType === "image/gif"
          ? "gif"
          : "jpg";

  // Use storyId + hash for cache-busting on updates
  const hash = crypto.createHash("md5").update(buffer).digest("hex").slice(0, 8);
  const path = `${storyId}/${hash}.${ext}`;

  const { error } = await client.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimeType,
    upsert: true,
    cacheControl: "public, max-age=31536000", // 1 year (immutable via hash)
  });

  if (error) {
    console.error("Supabase Storage upload error:", error.message);
    return null;
  }

  // Get public URL
  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

/**
 * Delete all cover images for a story from Supabase Storage.
 */
export async function deleteCoverImages(storyId: string): Promise<void> {
  const client = getStorageClient();
  if (!client) return;

  try {
    const { data: files } = await client.storage.from(BUCKET).list(storyId);
    if (files && files.length > 0) {
      const paths = files.map((f) => `${storyId}/${f.name}`);
      await client.storage.from(BUCKET).remove(paths);
    }
  } catch (err) {
    console.warn("Failed to clean up storage covers:", err);
  }
}

/**
 * Check if a coverImage value is a URL (cloud storage) vs base64 data URI.
 */
export function isCoverUrl(coverImage: string): boolean {
  return coverImage.startsWith("http://") || coverImage.startsWith("https://");
}
