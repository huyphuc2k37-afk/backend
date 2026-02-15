-- Enable RLS on all tables and create policies for the postgres role (used by Prisma)
-- This satisfies Supabase Security Advisor while keeping Prisma access intact

-- _prisma_migrations
ALTER TABLE IF EXISTS public._prisma_migrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public._prisma_migrations FOR ALL TO postgres USING (true) WITH CHECK (true);

-- User
ALTER TABLE IF EXISTS public."User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."User" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Chapter
ALTER TABLE IF EXISTS public."Chapter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Chapter" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Bookmark
ALTER TABLE IF EXISTS public."Bookmark" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Bookmark" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- ReadHistory
ALTER TABLE IF EXISTS public."ReadHistory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."ReadHistory" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- StoryLike
ALTER TABLE IF EXISTS public."StoryLike" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."StoryLike" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Deposit
ALTER TABLE IF EXISTS public."Deposit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Deposit" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- ChapterPurchase
ALTER TABLE IF EXISTS public."ChapterPurchase" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."ChapterPurchase" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Withdrawal
ALTER TABLE IF EXISTS public."Withdrawal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Withdrawal" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Story
ALTER TABLE IF EXISTS public."Story" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Story" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Rating
ALTER TABLE IF EXISTS public."Rating" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Rating" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Comment
ALTER TABLE IF EXISTS public."Comment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Comment" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Notification
ALTER TABLE IF EXISTS public."Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Notification" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- CommentLike
ALTER TABLE IF EXISTS public."CommentLike" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."CommentLike" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Follow
ALTER TABLE IF EXISTS public."Follow" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Follow" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- Announcement
ALTER TABLE IF EXISTS public."Announcement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."Announcement" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- PlatformEarning
ALTER TABLE IF EXISTS public."PlatformEarning" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."PlatformEarning" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- AuthorEarning
ALTER TABLE IF EXISTS public."AuthorEarning" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."AuthorEarning" FOR ALL TO postgres USING (true) WITH CHECK (true);

-- ReferralEarning
ALTER TABLE IF EXISTS public."ReferralEarning" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for postgres" ON public."ReferralEarning" FOR ALL TO postgres USING (true) WITH CHECK (true);
