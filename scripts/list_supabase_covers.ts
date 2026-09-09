/**
 * List 39 Supabase-cover stories + author email.
 * No destructive write. Safe to run anytime.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  try {
    const stories = await prisma.story.findMany({
      where: { coverImage: { contains: 'supabase.co' } },
      select: {
        id: true,
        title: true,
        slug: true,
        coverImage: true,
        status: true,
        updatedAt: true,
        author: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    console.log(`Total: ${stories.length} stories with Supabase cover\n`);
    console.log('| # | Title | Slug | Status | UpdatedAt | Author | Email |');
    console.log('|---|-------|------|--------|-----------|--------|-------|');
    stories.forEach((s, i) => {
      const d = s.updatedAt.toISOString().slice(0, 10);
      console.log(`| ${i + 1} | ${s.title} | ${s.slug} | ${s.status} | ${d} | ${s.author?.name || '-'} | ${s.author?.email || '-'} |`);
    });

    // CSV to stdout for easy copy
    console.log('\n\nCSV (for email blast):');
    console.log('Title,Slug,AuthorName,AuthorEmail');
    stories.forEach((s) => {
      console.log(`"${(s.title || '').replace(/"/g, '""')}","${s.slug}","${(s.author?.name || '').replace(/"/g, '""')}","${s.author?.email || ''}"`);
    });
  } catch (e) {
    console.error('ERR', e);
  } finally {
    await prisma.$disconnect();
  }
})();
