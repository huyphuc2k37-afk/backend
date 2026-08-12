import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔎 TÌM NGUỒN COIN BALANCE BỊ "ORPHAN"\n');

  // Lấy top 20 user có coinBalance cao mà không có nguồn rõ ràng
  const suspects = [
    'hoahuongduong272018@gmail.com', // admin 84,450
    'rosiew1022@gmail.com',          // 64,967
    'maihoanglan1995@gmail.com',     // 50,104
    'trungchalawan@gmail.com',       // 41,858
    'huntersho3@gmail.com',          // 37,964
    'tacgiamochiamanda402@gmail.com',// 23,193
    'creper3366@gmail.com',          // 23,414
    'miemie6072017@gmail.com',       // 21,334
    'nguyenthiquynhanh102@gmail.com',// 21,187
    'phongnguyetchikiem@gmail.com',  // 20,290
    'minhhhienn2010@gmail.com',      // 20,000
    'nguyenthethuong2881993@gmail.com',// 17,032
    'linhshinokimnguu15@gmail.com',  // 19,340 (mod)
  ];

  for (const email of suspects) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) continue;
    console.log(`\n════════ ${email.padEnd(40)} coinBalance=${u.coinBalance.toLocaleString()} ════════`);

    const [deposits, credits, earnings, authorEarnings, readerGifts, sentGifts, withdrawals, adRewards, authorAdEarnings, dailyQuests] = await Promise.all([
      prisma.deposit.findMany({ where: { userId: u.id } }),
      prisma.adminCoinCredit.findMany({ where: { authorId: u.id } }),
      prisma.authorEarning.findMany({ where: { authorId: u.id } }),
      prisma.authorEarning.findMany({ where: { fromUserId: u.id } }),
      prisma.giftTransaction.findMany({ where: { receiverId: u.id } }),
      prisma.giftTransaction.findMany({ where: { senderId: u.id } }),
      prisma.withdrawal.findMany({ where: { userId: u.id } }),
      prisma.adReward.findMany({ where: { userId: u.id } }),
      prisma.authorAdEarning.findMany({ where: { authorId: u.id } }),
      prisma.dailyQuest.findMany({ where: { userId: u.id } }),
    ]);

    const sumDeposits = deposits.reduce((s, d) => s + (d.status === 'approved' ? d.coins : 0), 0);
    const sumCredits = credits.reduce((s, c) => s + c.amount, 0);
    const sumEarnings = earnings.reduce((s, e) => s + e.amount, 0);
    const sumReaderGifts = readerGifts.reduce((s, g) => s + g.totalCoins, 0);
    const sumAdEarnings = authorAdEarnings.reduce((s, e) => s + e.earnings, 0);
    const sumAdRewards = adRewards.reduce((s, a) => s + a.coins, 0);
    const sumDailyQuests = dailyQuests.reduce((s, d) => s + d.coinsEarned, 0);

    console.log(`  deposits (approved coins):     ${sumDeposits.toLocaleString()}`);
    console.log(`  AdminCoinCredit:               ${sumCredits.toLocaleString()} (${credits.length} lượt)`);
    console.log(`  AuthorEarning (received):      ${sumEarnings.toLocaleString()} (${earnings.length} lượt)`);
    console.log(`  ReaderGiftTransaction (nhận):  ${sumReaderGifts.toLocaleString()} (${readerGifts.length} lượt)`);
    console.log(`  AdReward:                      ${sumAdRewards.toLocaleString()} (${adRewards.length} lượt)`);
    console.log(`  AuthorAdEarning:               ${sumAdEarnings.toLocaleString()} (${authorAdEarnings.length} lượt)`);
    console.log(`  DailyQuest coinsEarned:        ${sumDailyQuests.toLocaleString()} (${dailyQuests.length} record)`);
    console.log(`  Withdrawals:                   ${withdrawals.length}`);
    console.log(`  --`);
    const accounted = sumDeposits + sumCredits + sumEarnings + sumReaderGifts + sumAdEarnings + sumAdRewards + sumDailyQuests;
    const orphan = u.coinBalance - accounted;
    console.log(`  TỔNG CÓ NGUỒN:                ${accounted.toLocaleString()}`);
    console.log(`  coinBalance hiện tại:          ${u.coinBalance.toLocaleString()}`);
    console.log(`  CHÊNH LỆCH (không rõ nguồn):  ${orphan.toLocaleString()} ${orphan !== 0 ? '⚠️' : '✅'}`);
  }

  // Tổng quát: thống kê tất cả user có orphan coin
  console.log('\n\n════════ TỔNG HỢP ORPHAN COIN ════════');
  const allUsers = await prisma.user.findMany({
    where: { coinBalance: { gt: 0 } },
    select: { id: true, email: true, coinBalance: true },
  });

  let totalCoin = 0;
  let totalOrphan = 0;
  let orphanUsers = 0;

  for (const u of allUsers) {
    const [deposits, credits, earnings, readerGifts, adRewards, authorAdEarnings, dailyQuests] = await Promise.all([
      prisma.deposit.findMany({ where: { userId: u.id } }),
      prisma.adminCoinCredit.findMany({ where: { authorId: u.id } }),
      prisma.authorEarning.findMany({ where: { authorId: u.id } }),
      prisma.giftTransaction.findMany({ where: { receiverId: u.id } }),
      prisma.adReward.findMany({ where: { userId: u.id } }),
      prisma.authorAdEarning.findMany({ where: { authorId: u.id } }),
      prisma.dailyQuest.findMany({ where: { userId: u.id } }),
    ]);
    const sumDeposits = deposits.reduce((s, d) => s + (d.status === 'approved' ? d.coins : 0), 0);
    const sumCredits = credits.reduce((s, c) => s + c.amount, 0);
    const sumEarnings = earnings.reduce((s, e) => s + e.amount, 0);
    const sumReaderGifts = readerGifts.reduce((s, g) => s + g.totalCoins, 0);
    const sumAdEarnings = authorAdEarnings.reduce((s, e) => s + e.earnings, 0);
    const sumAdRewards = adRewards.reduce((s, a) => s + a.coins, 0);
    const sumDailyQuests = dailyQuests.reduce((s, d) => s + d.coinsEarned, 0);
    const accounted = sumDeposits + sumCredits + sumEarnings + sumReaderGifts + sumAdEarnings + sumAdRewards + sumDailyQuests;
    const orphan = u.coinBalance - accounted;
    totalCoin += u.coinBalance;
    if (orphan !== 0) {
      totalOrphan += orphan;
      orphanUsers++;
    }
  }
  console.log(`Tổng coinBalance toàn hệ thống: ${totalCoin.toLocaleString()}`);
  console.log(`Tổng coin "không có nguồn audit": ${totalOrphan.toLocaleString()} (chiếm ${(totalOrphan/totalCoin*100).toFixed(1)}%)`);
  console.log(`Số user bị orphan coin: ${orphanUsers}/${allUsers.length}`);
}

main()
  .catch((e) => { console.error('❌', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });