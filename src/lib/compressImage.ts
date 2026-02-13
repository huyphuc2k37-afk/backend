import sharp from "sharp";

/**
 * Compress a base64 data-URI image.
 * Input:  "data:image/png;base64,iVBO..."
 * Output: "data:image/webp;base64,..." (compressed)
 *
 * Target: max 800px wide, quality 75, WebP format → typically 50-200 KB.
 */
export async function compressBase64Image(dataUri: string): Promise<string> {
  const match = dataUri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) return dataUri; // not a valid data URI, return as-is

  const base64Data = match[2];
  const inputBuffer = Buffer.from(base64Data, "base64");

  const inputSizeKB = Math.round(inputBuffer.length / 1024);

  // Skip if already small (< 200 KB)
  if (inputBuffer.length < 200 * 1024) {
    return dataUri;
  }

  try {
    const compressed = await sharp(inputBuffer)
      .resize(800, 1200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();

    const outputSizeKB = Math.round(compressed.length / 1024);
    console.log(`Image compressed: ${inputSizeKB} KB → ${outputSizeKB} KB (${Math.round((1 - outputSizeKB / inputSizeKB) * 100)}% reduction)`);

    return `data:image/webp;base64,${compressed.toString("base64")}`;
  } catch (error) {
    console.warn("Image compression failed, using original:", error);
    return dataUri;
  }
}
