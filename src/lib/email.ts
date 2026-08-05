/**
 * Normalize an email address to prevent Gmail dot-trick abuse.
 * Gmail ignores dots and everything after + in the local part.
 * e.g. h.i.h.iha+spam@gmail.com → hihiha@gmail.com
 */
export function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().trim().split("@");
  if (!local || !domain) return email.toLowerCase().trim();
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const cleaned = local.replace(/\./g, "").replace(/\+.*$/, "");
    return `${cleaned}@gmail.com`;
  }
  return `${local}@${domain}`;
}
