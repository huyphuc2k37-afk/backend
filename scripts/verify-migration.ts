import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const st = await p.storyTag.count();
  const cats = await p.category.count();
  const tags = await p.tag.count();
  const reds = await p.redirect.count();
  console.log(`StoryTags=${st} | Categories=${cats} | Tags=${tags} | Redirects=${reds}`);

  const stories = await p.story.findMany({
    select: { genre: true, category: { select: { name: true } }, _count: { select: { storyTags: true } } },
  });
  for (const s of stories) {
    console.log(`"${s.genre}" → ${s.category?.name || "NULL"} (${s._count.storyTags} tags)`);
  }
}
main().finally(() => p.$disconnect());
