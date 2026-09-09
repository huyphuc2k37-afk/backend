// Debug: check locked chapter purchases for a specific user + story
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  try {
    const email = 'phuthuyaoden1508@gmail.com';
    const storyTitlePart = 'Khai Cục Thành';

    // 1. Find user
    const user = await p.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        coinBalance: true,
        role: true,
        createdAt: true,
      },
    });
    console.log('=== USER ===');
    console.log(JSON.stringify(user, null, 2));

    if (!user) {
      console.log('USER NOT FOUND');
      await p.$disconnect();
      return;
    }

    // 2. Find story
    const story = await p.story.findFirst({
      where: {
        OR: [
          { title: { contains: storyTitlePart, mode: 'insensitive' } },
          { slug: { contains: 'khai-cuc', mode: 'insensitive' } },
          { slug: { contains: 'ta-da-hung', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        title: true,
        slug: true,
        authorId: true,
        approvalStatus: true,
      },
    });
    console.log('=== STORY ===');
    console.log(JSON.stringify(story, null, 2));

    if (!story) {
      console.log('STORY NOT FOUND');
      await p.$disconnect();
      return;
    }

    // 3. Find all chapters of this story
    const chapters = await p.chapter.findMany({
      where: { storyId: story.id },
      select: {
        id: true,
        number: true,
        title: true,
        isLocked: true,
        price: true,
        approvalStatus: true,
        createdAt: true,
      },
      orderBy: { number: 'asc' },
    });
    console.log(`=== ALL CHAPTERS (${chapters.length}) ===`);
    const targetNumbers = [271, 272, 273, 274, 278, 279];
    chapters
      .filter((c) => targetNumbers.includes(c.number))
      .forEach((c) => {
        console.log(`  Ch${c.number} | id=${c.id} | locked=${c.isLocked} | price=${c.price} | status=${c.approvalStatus} | "${c.title}"`);
      });

    // 4. Find all purchases by this user for this story
    const purchases = await p.chapterPurchase.findMany({
      where: {
        userId: user.id,
        chapter: { storyId: story.id },
      },
      select: {
        id: true,
        chapterId: true,
        coins: true,
        createdAt: true,
        chapter: {
          select: {
            number: true,
            title: true,
            isLocked: true,
            price: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`=== PURCHASES BY USER (${purchases.length} total) ===`);
    purchases.forEach((p) => {
      console.log(`  Ch${p.chapter.number} | id=${p.id} | paid=${p.coins} xu | locked_now=${p.chapter.isLocked} | price_now=${p.chapter.price} | "${p.chapter.title}"`);
    });

    // 5. Show which target chapters user has already bought
    console.log('=== TARGET CHAPTERS PURCHASE STATUS ===');
    targetNumbers.forEach((num) => {
      const ch = chapters.find((c) => c.number === num);
      const purchase = purchases.find((p) => p.chapter.number === num);
      if (!ch) {
        console.log(`  Ch${num}: NOT FOUND in DB`);
      } else {
        console.log(
          `  Ch${num}: ${purchase ? '✅ BOUGHT' : '❌ NOT BOUGHT'} | isLocked=${ch.isLocked} | price=${ch.price} | "${ch.title}"`
        );
      }
    });

    // 6. Check user coin balance
    console.log(`\n=== USER COIN BALANCE: ${user.coinBalance} xu ===`);

    // 7. Check read history
    const readHistory = await p.readHistory.findMany({
      where: {
        userId: user.id,
        storyId: story.id,
      },
      select: {
        chapterId: true,
        lastReadAt: true,
        chapter: { select: { number: true, title: true, isLocked: true } },
      },
      orderBy: { lastReadAt: 'desc' },
      take: 10,
    });
    console.log(`=== RECENT READ HISTORY (${readHistory.length}) ===`);
    readHistory.forEach((r) => {
      console.log(`  Ch${r.chapter.number} | lastRead=${r.lastReadAt.toISOString()} | locked_now=${r.chapter.isLocked} | "${r.chapter.title}"`);
    });
  } catch (e) {
    console.error('ERROR:', e.message);
    console.error('STACK:', e.stack);
  } finally {
    await p.$disconnect();
  }
})();
