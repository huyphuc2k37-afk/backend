/**
 * Cloudinary helper for cover images (fallback khi Supabase hết quota).
 *
 * Env cần có:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 * Cloudinary free: 25GB storage + 25GB bandwidth/tháng
 * Dashboard: https://console.cloudinary.com/
 */

import crypto from "crypto";

let _enabled: boolean | null = null;
function enabled(): boolean {
  if (_enabled !== null) return _enabled;
  _enabled = !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
  return _enabled;
}

export function isCloudinaryEnabled(): boolean {
  return enabled();
}

function buildSignature(params: Record<string, string | number>, apiSecret: string): string {
  // Cloudinary signature = sha1 of (sorted key=value pairs joined by & + apiSecret)
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(sorted + apiSecret).digest("hex");
}

/**
 * Upload base64 data-URI to Cloudinary.
 * Returns secure HTTPS URL, or null on failure.
 */
export async function uploadCoverToCloudinary(
  dataUri: string,
  storyId: string
): Promise<string | null> {
  if (!enabled()) return null;

  const match = dataUri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) return null;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
  const apiKey = process.env.CLOUDINARY_API_KEY!;
  const apiSecret = process.env.CLOUDINARY_API_SECRET!;

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "vstory/covers";
  const publicId = `${storyId}_${timestamp}`;

  const params: Record<string, string | number> = {
    folder,
    public_id: publicId,
    timestamp,
  };
  const signature = buildSignature(params, apiSecret);

  // Cloudinary upload endpoint
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

  const form = new FormData();
  form.append("file", dataUri);
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("public_id", publicId);
  form.append("signature", signature);

  try {
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.text();
      console.error(`Cloudinary upload failed (${res.status}):`, err.slice(0, 200));
      return null;
    }
    const json = (await res.json()) as { secure_url?: string };
    return json.secure_url || null;
  } catch (err) {
    console.error("Cloudinary upload error:", (err as Error).message);
    return null;
  }
}
