-- ============================================================
-- Fix Supabase Security Advisor issues
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── 1. Enable RLS on missing tables (CRITICAL) ────────────

-- Category
ALTER TABLE IF EXISTS public."Category" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Category" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Tag
ALTER TABLE IF EXISTS public."Tag" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Tag" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- StoryTag
ALTER TABLE IF EXISTS public."StoryTag" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."StoryTag" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Conversation
ALTER TABLE IF EXISTS public."Conversation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Conversation" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- ConversationParticipant
ALTER TABLE IF EXISTS public."ConversationParticipant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."ConversationParticipant" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Message
ALTER TABLE IF EXISTS public."Message" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Message" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Redirect
ALTER TABLE IF EXISTS public."Redirect" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Redirect" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- ViewLog
ALTER TABLE IF EXISTS public."ViewLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."ViewLog" FOR ALL TO postgres USING (true) WITH CHECK (true);


-- ─── 2. Enable Leaked Password Protection (Auth) ───────────
-- This CANNOT be done via SQL. You need to do this manually:
-- Supabase Dashboard → Authentication → Providers → Email
-- → Enable "Leaked Password Protection"
-- (Or: Settings → Auth → Security → Enable Leaked Password Protection)


-- ─── 3. Drop unused indexes ────────────────────────────────
-- Supabase reports "Unused Index" when an index exists but has
-- never been used by any query. These are safe to drop.
-- However, Prisma's @@unique creates indexes that ARE needed
-- for constraint enforcement. Only drop plain @@index ones.
--
-- NOTE: "Unused" in Supabase means pg_stat_user_indexes.idx_scan = 0
-- since the last stats reset. Some may become useful with more traffic.
-- The ones below are typically safe because FK columns already have
-- implicit indexes or the query patterns don't use them.

-- Check which indexes are truly unused before dropping:
-- SELECT schemaname, relname, indexrelname, idx_scan
-- FROM pg_stat_user_indexes
-- WHERE idx_scan = 0 AND schemaname = 'public'
-- ORDER BY relname, indexrelname;

-- We'll keep all @@unique indexes (they enforce constraints)
-- and only drop @@index ones that are confirmed unused.
-- Uncomment the lines below ONLY after verifying with the query above:

-- DROP INDEX IF EXISTS "AuthorEarning_authorId_type_idx";
-- DROP INDEX IF EXISTS "Bookmark_userId_idx";
-- DROP INDEX IF EXISTS "ChapterPurchase_userId_idx";
