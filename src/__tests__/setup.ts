/**
 * Jest setup — runs once before all tests.
 * Sets up test environment variables so test code can never accidentally
 * hit the real database.
 */
import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/vstory_test";
process.env.DIRECT_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/vstory_test";
process.env.JWT_API_SECRET = "test-jwt-secret-for-integration-tests-only-32chars";
process.env.AUTH_SYNC_SECRET = "test-auth-sync-secret-for-integration-tests";
process.env.VIEW_TOKEN_SECRET = "test-view-token-secret-integration-tests-32c";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.NEXTAUTH_SECRET = "test-nextauth-secret-for-integration-tests";
process.env.FRONTEND_URL = "http://localhost:3000";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.TELEGRAM_CHAT_ID = "";
process.env.SENTRY_DSN = "";
process.env.CLOUDINARY_CLOUD_NAME = "";
process.env.CLOUDINARY_API_KEY = "";
process.env.CLOUDINARY_API_SECRET = "";
