import { compressBase64Image } from "../../lib/compressImage";

// Minimal 1×1 red PNG as base64 data URI (67 bytes — below compress threshold)
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

describe("compressBase64Image", () => {
  it("should return small images unchanged (< 200KB threshold)", async () => {
    const result = await compressBase64Image(TINY_PNG);
    expect(result).toBe(TINY_PNG); // unchanged
  });

  it("should return non-data-URI strings unchanged", async () => {
    const input = "not a data uri";
    const result = await compressBase64Image(input);
    expect(result).toBe(input);
  });

  it("should return URLs unchanged", async () => {
    const url = "https://example.com/image.jpg";
    const result = await compressBase64Image(url);
    expect(result).toBe(url);
  });
});
