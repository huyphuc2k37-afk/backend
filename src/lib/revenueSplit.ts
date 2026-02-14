export type RevenueSplit = {
  gross: number;
  author: number;
  platform: number;
  tax: number;
};

// 65% author, 30% platform, 5% tax
const AUTHOR_RATE = 0.65;
const TAX_RATE = 0.05;

export function splitRevenue(grossAmount: number): RevenueSplit {
  const gross = Number(grossAmount);
  if (!Number.isFinite(gross) || gross <= 0) {
    return { gross: 0, author: 0, platform: 0, tax: 0 };
  }

  // Use integer-safe rounding: floor author & tax, platform gets the remainder.
  const author = Math.floor(gross * AUTHOR_RATE);
  const tax = Math.floor(gross * TAX_RATE);
  const platform = Math.max(0, gross - author - tax);

  return { gross, author, platform, tax };
}
