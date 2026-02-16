import { isStorageEnabled, isCoverUrl } from "../../lib/supabaseStorage";

describe("supabaseStorage", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("isStorageEnabled()", () => {
    it("should return false when SUPABASE_SERVICE_ROLE_KEY is not set", () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(isStorageEnabled()).toBe(false);
    });

    it("should return false when SUPABASE_URL is not set", () => {
      delete process.env.SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
      expect(isStorageEnabled()).toBe(false);
    });

    it("should return true when both are set", () => {
      process.env.SUPABASE_URL = "https://example.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
      expect(isStorageEnabled()).toBe(true);
    });
  });

  describe("isCoverUrl()", () => {
    it("should return true for https URLs", () => {
      expect(isCoverUrl("https://example.com/image.jpg")).toBe(true);
    });

    it("should return true for http URLs", () => {
      expect(isCoverUrl("http://example.com/image.jpg")).toBe(true);
    });

    it("should return false for base64 data URIs", () => {
      expect(isCoverUrl("data:image/png;base64,iVBO...")).toBe(false);
    });

    it("should return false for empty strings", () => {
      expect(isCoverUrl("")).toBe(false);
    });
  });
});
