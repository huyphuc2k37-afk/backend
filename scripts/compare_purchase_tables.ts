import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  // So sánh tổng ChapterPurchase (gross) với tổng AuthorEarning(type=purchase).amount/0.65
  const cp = await p.chapterPurchase.aggregate({ _sum: { coins: true }, _count: true });
  const aePurchase = await p.authorEarning.aggregate({ _sum: { amount: true }, _count: true, where: { type: 'purchase' } });

  const totalCP = cp._sum.coins ?? 0; // gross reader trả (theo ChapterPurchase)
  const totalAE_author = aePurchase._sum.amount ?? 0; // author nhận (65% sau floor)
  // gross tương ứng của author earning, suy ra gross = authorShare/0.65 (làm tròn lên)
  const estGrossFromAE = Math.round(totalAE_author / 0.65);

  console.log(`ChapterPurchase:`);
  console.log(`  count: ${cp._count}`);
  console.log(`  total coins: ${totalCP.toLocaleString('vi-VN')} xu`);
  console.log(`AuthorEarning(type=purchase):`);
  console.log(`  count: ${aePurchase._count}`);
  console.log(`  total author share: ${totalAE_author.toLocaleString('vi-VN')} xu`);
  console.log(`  estimated gross = authorShare/0.65: ${estGrossFromAE.toLocaleString('vi-VN')} xu`);
  console.log(`\nCHÊNH LỆCH gross:`);
  console.log(`  estimatedGross - ChapterPurchaseTotal = ${(estGrossFromAE - totalCP).toLocaleString('vi-VN')} xu`);
  console.log(`  = số xu reader đã trả mà ChapterPurchase KHÔNG ghi nhận`);

  // Đếm số user có AuthorEarning(type=purchase) nhưng không có ChapterPurchase
  const buyersWithAE = await p.authorEarning.findMany({
    where: { type: 'purchase', fromUserId: { not: null } },
    select: { fromUserId: true },
    distinct: ['fromUserId'],
  });
  const buyersWithCP = await p.chapterPurchase.findMany({
    select: { userId: true },
    distinct: ['userId'],
  });
  const buyerIdsAE = new Set(buyersWithAE.map((b: any) => b.fromUserId));
  const buyerIdsCP = new Set(buyersWithCP.map((b: any) => b.userId));
  const onlyAE = [...buyerIdsAE].filter((id: any) => !buyerIdsCP.has(id));
  console.log(`\nUser chỉ có AuthorEarning(purchase) mà KHÔNG có ChapterPurchase: ${onlyAE.length} user`);

  // Sample 5 user đầu tiên
  if (onlyAE.length > 0) {
    const sample = await p.user.findMany({ where: { id: { in: onlyAE.slice(0, 5) } }, select: { email: true, coinBalance: true } });
    console.log(`  Sample 5 user:`);
    for (const u of sample) {
      const userEarnings = await p.authorEarning.findMany({ where: { type: 'purchase', fromUserId: u.id }, select: { amount: true } });
      const totalAuthorShare = userEarnings.reduce((s, e) => s + e.amount, 0);
      console.log(`    ${u.email.padEnd(40)} coinBalance=${u.coinBalance}  totalPurchaseShare=${totalAuthorShare}`);
    }
  }

  await p.$disconnect();
})();