import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== TONG KET COIN BALANCE VA AMOUNT ===\n');

  // 1) Tổng xu hiện có trong hệ thống
  const agg = await prisma.user.aggregate({ _sum: { coinBalance: true }, _count: { id: true } });
  console.log(`Tổng coinBalance toàn hệ thống: ${agg._sum.coinBalance?.toLocaleString('vi-VN')}`);
  console.log(`Tổng user: ${agg._count.id}`);

  // 2) User có coinBalance < 0
  const negatives = await prisma.user.findMany({
    where: { coinBalance: { lt: 0 } },
    select: { id: true, email: true, name: true, coinBalance: true, role: true },
    orderBy: { coinBalance: 'asc' },
  });
  console.log(`\n=== User có coinBalance ÂM: ${negatives.length} ===`);
  for (const u of negatives) {
    console.log(`  ${u.coinBalance.toString().padStart(8)}  ${u.email.padEnd(40)}  ${u.role}`);
  }

  // 3) Tính tổng "xu có nguồn gốc" được ghi nhận
  const [deposits, credits, earnings, readerGifts, authorGifts, purchases, adRewards, authorAdEarnings, dailyQuests, referralEarnings] = await Promise.all([
    prisma.deposit.aggregate({ _sum: { coins: true }, where: { status: 'approved' } }),
    prisma.adminCoinCredit.aggregate({ _sum: { amount: true } }),
    prisma.authorEarning.aggregate({ _sum: { amount: true } }),
    prisma.giftTransaction.aggregate({ _sum: { totalCoins: true } }),
    prisma.giftTransaction.aggregate({ _sum: { totalCoins: true } }),
    prisma.chapterPurchase.aggregate({ _sum: { coins: true } }),
    prisma.adReward.aggregate({ _sum: { coins: true } }),
    prisma.authorAdEarning.aggregate({ _sum: { earnings: true } }),
    prisma.dailyQuest.aggregate({ _sum: { coinsEarned: true } }),
    prisma.referralEarning.aggregate({ _sum: { amount: true } }),
  ]);

  console.log(`\n=== Tổng xu đã ghi nhận trong các bảng audit ===`);
  console.log(`  Deposit (approved):      +${deposits._sum.coins?.toLocaleString('vi-VN')}`);
  console.log(`  AdminCoinCredit:         +${credits._sum.amount?.toLocaleString('vi-VN')}`);
  console.log(`  AuthorEarning:           +${earnings._sum.amount?.toLocaleString('vi-VN')}  (đã gồm purchase + tip + gift + view + admin)`);
  console.log(`  GiftTransaction sent:    +${authorGifts._sum.totalCoins?.toLocaleString('vi-VN')}  (xu gross)`);
  console.log(`  GiftTransaction receiver +${readerGifts._sum.totalCoins?.toLocaleString('vi-VN')}  (xu gross)`);
  console.log(`  ChapterPurchase:         -${purchases._sum.coins?.toLocaleString('vi-VN')}  (xu gross)`);
  console.log(`  AdReward:                +${adRewards._sum.coins?.toLocaleString('vi-VN')}`);
  console.log(`  AuthorAdEarning:         +${authorAdEarnings._sum.earnings?.toLocaleString('vi-VN')}`);
  console.log(`  DailyQuest:              +${dailyQuests._sum.coinsEarned?.toLocaleString('vi-VN')}`);
  console.log(`  ReferralEarning:         +${referralEarnings._sum.amount?.toLocaleString('vi-VN')}`);

  // 4) Thống kê authorEarning theo type
  const earningsByType = await prisma.authorEarning.groupBy({
    by: ['type'],
    _sum: { amount: true },
    _count: { id: true },
  });
  console.log(`\n  Chi tiết AuthorEarning theo type:`);
  for (const e of earningsByType.sort((a, b) => Number(b._sum.amount) - Number(a._sum.amount))) {
    console.log(`    ${e.type.padEnd(10)}  +${e._sum.amount?.toLocaleString('vi-VN')}  (${e._count.id} records)`);
  }

  // 5) Tính tổng xu ròng vào "ví users" từ mọi nguồn (chỉ cộng)
  const totalIn = Number(deposits._sum.coins ?? 0) + Number(credits._sum.amount ?? 0)
                + Number(earnings._sum.amount ?? 0) + Number(adRewards._sum.coins ?? 0)
                + Number(authorAdEarnings._sum.earnings ?? 0) + Number(dailyQuests._sum.coinsEarned ?? 0)
                + Number(referralEarnings._sum.amount ?? 0);
  console.log(`\n  Tổng xu RÒNG vào (không tính purchases/gifts vì đã nằm trong earnings):`);
  console.log(`    Deposit + AdminCredit + Earnings + AdReward + AuthorAdEarning + Quest + Referral = ${totalIn.toLocaleString('vi-VN')}`);
  console.log(`    (AuthorEarning đã gồm tất cả purchase+tip+gift+view+admin credit cho tác giả)`);
  console.log(`\n  Tổng coinBalance hiện tại của user:           ${agg._sum.coinBalance?.toLocaleString('vi-VN')}`);
  console.log(`  Lệch = in - currentBalance:                    ${(totalIn - Number(agg._sum.coinBalance ?? 0)).toLocaleString('vi-VN')}`);
  console.log(`    Lệch âm = có user "mất" xu (bị trừ không audit)`);
  console.log(`    Lệch dương = có user "có thêm" xu (cộng không audit, hoặc platform giữ)`);
  console.log(`    Lưu ý: platform fee 30% không nằm trong coinBalance của user nào`);
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });