import fs from "fs";
import path from "path";

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

  return `/storage/covers/cloudinary/${rel.split("\\").join("/")}`;
}
