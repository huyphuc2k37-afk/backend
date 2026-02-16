import { splitRevenue } from "../../lib/revenueSplit";

describe("splitRevenue", () => {
  it("should split 100 coins correctly (65/30/5)", () => {
    const result = splitRevenue(100);
    expect(result).toEqual({
      gross: 100,
      author: 65,
      platform: 30,
      tax: 5,
    });
  });

  it("should handle 1 coin (minimum)", () => {
    const result = splitRevenue(1);
    expect(result.gross).toBe(1);
    expect(result.author).toBe(0); // floor(0.65) = 0
    expect(result.tax).toBe(0); // floor(0.05) = 0
    expect(result.platform).toBe(1); // remainder
    expect(result.author + result.platform + result.tax).toBe(1);
  });

  it("should ensure author + platform + tax = gross", () => {
    for (const amount of [1, 2, 3, 5, 10, 13, 17, 50, 99, 100, 500, 999, 1000, 10000]) {
      const r = splitRevenue(amount);
      expect(r.author + r.platform + r.tax).toBe(r.gross);
    }
  });

  it("should handle large amounts", () => {
    const result = splitRevenue(1000000);
    expect(result.author).toBe(650000);
    expect(result.tax).toBe(50000);
    expect(result.platform).toBe(300000);
  });

  it("should return zeros for invalid input", () => {
    expect(splitRevenue(0)).toEqual({ gross: 0, author: 0, platform: 0, tax: 0 });
    expect(splitRevenue(-5)).toEqual({ gross: 0, author: 0, platform: 0, tax: 0 });
    expect(splitRevenue(NaN)).toEqual({ gross: 0, author: 0, platform: 0, tax: 0 });
    expect(splitRevenue(Infinity)).toEqual({ gross: 0, author: 0, platform: 0, tax: 0 });
  });

  it("should not give negative platform share", () => {
    for (let i = 1; i <= 200; i++) {
      const r = splitRevenue(i);
      expect(r.platform).toBeGreaterThanOrEqual(0);
      expect(r.author).toBeGreaterThanOrEqual(0);
      expect(r.tax).toBeGreaterThanOrEqual(0);
    }
  });

  it("should give author roughly 65%", () => {
    const r = splitRevenue(10000);
    expect(r.author / r.gross).toBeCloseTo(0.65, 2);
  });
});
