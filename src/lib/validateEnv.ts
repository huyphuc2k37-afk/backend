/**
 * Validates required environment variables on startup.
 * Exits the process with a clear error if critical variables are missing in production.
 * In development, missing non-critical variables produce warnings instead.
 */

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function validateEnv(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProd = process.env.NODE_ENV === "production";

  const requiredInProd = [
    { name: "DATABASE_URL", reason: "Database connection is required" },
    { name: "JWT_API_SECRET", reason: "JWT token signing requires a dedicated secret" },
    { name: "AUTH_SYNC_SECRET", reason: "Frontend-backend auth sync requires a dedicated secret" },
    { name: "SUPABASE_URL", reason: "Supabase client requires URL" },
    { name: "SUPABASE_ANON_KEY", reason: "Supabase client requires anon key" },
  ];

  const recommended = [
    { name: "VIEW_TOKEN_SECRET", reason: "View counting lacks spoofing protection without this" },
    { name: "SENTRY_DSN", reason: "Error monitoring is strongly recommended in production" },
    { name: "FRONTEND_URL", reason: "CORS may not work correctly without this" },
    { name: "NEXTAUTH_SECRET", reason: "NextAuth session signing requires this" },
  ];

  for (const req of requiredInProd) {
    if (!process.env[req.name]) {
      if (isProd) {
        errors.push(`[env] ${req.name} is not set — ${req.reason}`);
      }
    }
  }

  for (const rec of recommended) {
    if (!process.env[rec.name]) {
      warnings.push(`[env] ${rec.name} is not set — ${rec.reason}`);
    }
  }

  // Warn if falling back to NEXTAUTH_SECRET for JWT (security concern)
  if (isProd && process.env.JWT_API_SECRET && process.env.NEXTAUTH_SECRET && process.env.JWT_API_SECRET === process.env.NEXTAUTH_SECRET) {
    warnings.push(
      "[env] JWT_API_SECRET and NEXTAUTH_SECRET have the same value. " +
      "Use separate secrets for better security isolation."
    );
  }

  // Validate URL formats if set (only for actual HTTP/HTTPS vars)
  const urlVars = ["SUPABASE_URL", "FRONTEND_URL", "BACKEND_PUBLIC_URL"];
  for (const varName of urlVars) {
    const val = process.env[varName];
    if (val && !val.startsWith("http://") && !val.startsWith("https://")) {
      errors.push(`[env] ${varName} must start with http:// or https://, got: ${val}`);
    }
  }

  // Validate Sentry DSN format if set
  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn && !sentryDsn.startsWith("https://")) {
    errors.push(`[env] SENTRY_DSN must be a valid HTTPS URL, got: ${sentryDsn}`);
  }

  return { errors, warnings };
}

let validated = false;

export function assertEnv(): void {
  if (validated) return;
  validated = true;

  const { errors, warnings } = validateEnv();

  for (const w of warnings) {
    console.warn(w);
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.error(e);
    }
    console.error("\n[env] Startup aborted due to missing required environment variables.");
    console.error("[env] See .env.example for the full list of required variables.\n");
    process.exit(1);
  }
}
