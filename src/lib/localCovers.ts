import fs from "fs";
import path from "path";

/**
 * Build an absolute URL for paths that originate on the backend (e.g.
 * /storage/... and /api/stories/:id/cover).
 *
 * Without this, the frontend (hosted on a different origin — Vercel at
 * https://vstory.vn) tries to fetch e.g. https://vstory.vn/storage/... and
 * gets a 404 because Vercel doesn't serve that path. By prepending the
 * backend's public origin we always emit a URL the browser can actually load.
 *
 * Falls back to the relative path if BACKEND_PUBLIC_URL is not configured —
 * which preserves existing dev behavior (Next dev proxy still works).
 */
export function absoluteBackendUrl(path: string): string {
  const base = process.env.BACKEND_PUBLIC_URL?.replace(/\/+$/, "");
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Resolve the on-disk path of a locally-mirrored Cloudinary cover.
 *
 * The download script wrote 79 covers into local-data/storage/covers/cloudinary/
 * with a manifest mapping storyId → relative file path. We use the manifest to
 * serve the local file when available (faster, no CDN dependency) and fall
 * back to the original Cloudinary URL otherwise.
 *
 * @returns local public path like "/storage/covers/cloudinary/v.../...webp",
 *          or null if no local mirror exists.
 */
type CloudinaryManifest = { covers: Record<string, string> };

let cachedManifest: CloudinaryManifest | null = null;
let manifestMtimeMs = 0;

function loadManifest(): CloudinaryManifest {
  const manifestPath = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "local-data",
    "storage",
    "covers",
    "cloudinary-manifest.json"
  );
  try {
    const stat = fs.statSync(manifestPath);
    // Re-read on file change (manifest is small, < 10KB)
    if (!cachedManifest || stat.mtimeMs !== manifestMtimeMs) {
      cachedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifestMtimeMs = stat.mtimeMs;
    }
    return cachedManifest!;
  } catch {
    // Manifest missing or unreadable — behave as if no local mirror exists
    return { covers: {} };
  }
}

export function getLocalCoverUrl(storyId: string): string | null {
  const manifest = loadManifest();
  const rel = manifest.covers?.[storyId];
  if (!rel) return null;

  // Verify file exists on disk before returning the URL
  const abs = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "local-data",
    "storage",
    "covers",
    "cloudinary",
    rel.replace(/\//g, path.sep)
  );
  if (!fs.existsSync(abs)) return null;

  return absoluteBackendUrl(`/storage/covers/cloudinary/${rel.split("\\").join("/")}`);
}
