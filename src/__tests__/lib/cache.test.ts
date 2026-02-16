import { cached, invalidateCache, SHORT_TTL, MEDIUM_TTL, LONG_TTL } from "../../lib/cache";
import cache from "../../lib/cache";

describe("cache utility", () => {
  afterEach(() => {
    // Clear cache between tests
    cache.flushAll();
  });

  describe("cached()", () => {
    it("should compute and cache the result on first call", async () => {
      let computeCount = 0;
      const compute = async () => {
        computeCount++;
        return { data: "hello" };
      };

      const result1 = await cached("test-key", 60, compute);
      expect(result1).toEqual({ data: "hello" });
      expect(computeCount).toBe(1);

      // Second call should use cache
      const result2 = await cached("test-key", 60, compute);
      expect(result2).toEqual({ data: "hello" });
      expect(computeCount).toBe(1); // not called again
    });

    it("should re-compute after invalidation", async () => {
      let counter = 0;
      const compute = async () => ++counter;

      await cached("counter-key", 60, compute);
      expect(counter).toBe(1);

      invalidateCache("counter-key");

      const result = await cached("counter-key", 60, compute);
      expect(result).toBe(2);
    });
  });

  describe("invalidateCache()", () => {
    it("should invalidate exact keys", () => {
      cache.set("foo", 1);
      cache.set("bar", 2);

      invalidateCache("foo");

      expect(cache.get("foo")).toBeUndefined();
      expect(cache.get("bar")).toBe(2);
    });

    it("should invalidate wildcard prefix patterns", () => {
      cache.set("ranking:views:20", 1);
      cache.set("ranking:likes:10", 2);
      cache.set("stories:page1", 3);

      invalidateCache("ranking:*");

      expect(cache.get("ranking:views:20")).toBeUndefined();
      expect(cache.get("ranking:likes:10")).toBeUndefined();
      expect(cache.get("stories:page1")).toBe(3); // untouched
    });
  });

  describe("TTL constants", () => {
    it("should have correct values", () => {
      expect(SHORT_TTL).toBe(60);
      expect(MEDIUM_TTL).toBe(300);
      expect(LONG_TTL).toBe(1800);
    });
  });
});
