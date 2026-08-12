import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const c = await p.adminCoinCredit.count();
  const s = await p.adminCoinCredit.aggregate({ _sum: { amount: true } });
  console.log('AdminCoinCredit count:', c, ' sum:', s._sum.amount);
  const g = await p.giftTransaction.aggregate({ _sum: { totalCoins: true } });
  console.log('GiftTransaction sum:', g._sum.totalCoins);
  const a = await p.adReward.aggregate({ _sum: { coins: true } });
  console.log('AdReward sum:', a._sum.coins);
  const ae = await p.authorAdEarning.aggregate({ _sum: { earnings: true } });
  console.log('AuthorAdEarning sum:', ae._sum.earnings);
  await p.$disconnect();
})();