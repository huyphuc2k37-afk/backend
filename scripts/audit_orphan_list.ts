import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('DANH SACH 48 USER CO ORPHAN COIN (khong co nguon audit)\n');

  const users = await prisma.user.findMany({
    where: { coinBalance: { gt: 0 } },
    select: { id: true, email: true, role: true, coinBalance: true, createdAt: true },
  });

  const orphanList: { email: string; role: string; coinBalance: number; orphan: number; createdAt: Date }[] = [];

  for (const u of users) {
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
    if (orphan !== 0) {
      orphanList.push({ email: u.email, role: u.role, coinBalance: u.coinBalance, orphan, createdAt: u.createdAt });
    }
  }

  // Sắp xếp theo orphan giảm dần
  orphanList.sort((a, b) => b.orphan - a.orphan);
  console.log(`Tong ${orphanList.length} user.\n`);
  for (const u of orphanList) {
    const sign = u.orphan > 0 ? '+' : '';
    console.log(`  ${sign}${u.orphan.toString().padStart(7)}  ${u.email.padEnd(42)}  role=${u.role.padEnd(10)}  coinBalance=${u.coinBalance.toString().padStart(7)}  createdAt=${u.createdAt.toISOString().slice(0, 10)}`);
  }

  // Thống kê orphan theo role
  console.log('\nThong ke theo role:');
  const byRole = new Map<string, { count: number; total: number }>();
  for (const u of orphanList) {
    const cur = byRole.get(u.role) ?? { count: 0, total: 0 };
    cur.count++;
    cur.total += u.orphan;
    byRole.set(u.role, cur);
  }
  for (const [r, v] of byRole) {
    console.log(`  ${r.padEnd(10)} count=${v.count}  totalOrphan=${v.total.toLocaleString()}`);
  }

  // Phân nhóm theo mức orphan
  console.log('\nPhan nhom theo muc orphan:');
  const buckets = { 'exact-20000': 0, '0-1000': 0, '1000-10000': 0, '10000-20000': 0, '20000+': 0, 'negative': 0 };
  for (const u of orphanList) {
    if (u.orphan === 20000) buckets['exact-20000']++;
    else if (u.orphan < 0) buckets['negative']++;
    else if (u.orphan < 1000) buckets['0-1000']++;
    else if (u.orphan < 10000) buckets['1000-10000']++;
    else if (u.orphan < 20000) buckets['10000-20000']++;
    else buckets['20000+']++;
  }
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`  ${k.padEnd(15)} ${v}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });