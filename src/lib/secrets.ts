export function getJwtApiSecret(): string | null {
  return process.env.JWT_API_SECRET || process.env.NEXTAUTH_SECRET || null;
}

export function getAuthSyncSecret(): string | null {
  return process.env.AUTH_SYNC_SECRET || process.env.NEXTAUTH_SECRET || null;
}
