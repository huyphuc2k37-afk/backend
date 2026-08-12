import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔎 ĐÀO SÂU CÁC ĐIỂM NGHI VẤN\n');

  // 1) Tất cả admin + moderator + supermod
  console.log('════════ 1. ADMIN / MODERATOR / SUPERMOD ════════');
  const staff = await prisma.user.findMany({
    where: { OR: [{ role: 'admin' }, { role: 'moderator' }, { isSuperMod: true }] },
    select: {
      id: true, name: true, email: true, role: true, isSuperMod: true,
      coinBalance: true, provider: true, emailVerified: true,
      createdAt: true, updatedAt: true, image: true,
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  for (const u of staff) {
    console.log(`  [${u.role.padEnd(10)}] ${u.isSuperMod ? '★ ' : '  '}${u.email.padEnd(40)}`);
    console.log(`     id=${u.id}  name='${u.name}'  provider=${u.provider}  verified=${u.emailVerified}`);
    console.log(`     coinBalance=${u.coinBalance.toLocaleString()}  createdAt=${u.createdAt.toISOString().slice(0, 19)}`);
    console.log(`     updatedAt=${u.updatedAt.toISOString().slice(0, 19)}`);
    console.log(`     image=${u.image ?? '(none)'}`);
  }

  // 2) AdminCoinCredit cho admin có coinBalance cao
  console.log('\n════════ 2. AdminCoinCredit (cộng xu thủ công) ════════');
  const credits = await prisma.adminCoinCredit.findMany({
    include: {
      admin: { select: { email: true, role: true } },
      author: { select: { email: true, role: true, coinBalance: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`  Tổng ${credits.length} lượt cộng xu thủ công. Tổng xu đã cộng: ${credits.reduce((s, c) => s + c.amount, 0).toLocaleString()}`);
  console.log('  20 lượt mới nhất:');
  for (const c of credits.slice(0, 20)) {
    console.log(`    ${c.createdAt.toISOString().slice(0, 19)}  ${c.amount.toString().padStart(8)} xu  admin=${c.admin.email.padEnd(36)} → author=${c.author.email.padEnd(36)} (now=${c.author.coinBalance.toLocaleString()})`);
    console.log(`      reason: ${c.reason}`);
  }

  // 3) User có coinBalance >= 20,000 mà 0 deposit
  console.log('\n════════ 3. USER CÓ COIN CAO NHƯNG 0 DEPOSIT (có thể được cộng tay) ════════');
  const richNoDep = await prisma.user.findMany({
    where: {
      coinBalance: { gte: 20000 },
      deposits: { none: {} },
    },
    select: {
      id: true, name: true, email: true, role: true, coinBalance: true,
      createdAt: true, updatedAt: true, emailVerified: true, provider: true,
      _count: {
        select: {
          deposits: true, purchases: true, withdrawals: true, sentGifts: true,
          coinCreditsReceived: true,
        },
      },
    },
    orderBy: { coinBalance: 'desc' },
  });
  console.log(`  Tìm thấy ${richNoDep.length} user:`);
  for (const u of richNoDep) {
    console.log(`  ${u.coinBalance.toString().padStart(7)} xu  [${u.role.padEnd(9)}] ${u.email.padEnd(38)}`);
    console.log(`     id=${u.id}  deposits=${u._count.deposits}  purchases=${u._count.purchases}  withdrawals=${u._count.withdrawals}  gifts=${u._count.sentGifts}  creditsReceived=${u._count.coinCreditsReceived}`);
    console.log(`     verified=${u.emailVerified}  provider=${u.provider}  createdAt=${u.createdAt.toISOString().slice(0, 10)}`);
  }

  // 4) Kiểm tra user có email admin/special domains
  console.log('\n════════ 4. USER VỚI PROVIDER=GOOGLE NHƯNG DOMAIN KHÔNG PHẢI GMAIL ════════');
  const nonGmail = await prisma.user.findMany({
    where: { provider: 'google' },
    select: { id: true, name: true, email: true, role: true, coinBalance: true, createdAt: true, emailVerified: true },
  });
  const filtered = nonGmail.filter((u) => {
    const d = u.email.split('@')[1]?.toLowerCase();
    return d && d !== 'gmail.com' && d !== 'googlemail.com';
  });
  for (const u of filtered) {
    console.log(`  [${u.role.padEnd(9)}] ${u.email.padEnd(38)}  verified=${u.emailVerified}  createdAt=${u.createdAt.toISOString().slice(0, 10)}`);
    console.log(`     id=${u.id}  name='${u.name}'  coinBalance=${u.coinBalance.toLocaleString()}`);
  }

  // 5) Tổng coinBalance theo role để hiểu phân phối
  console.log('\n════════ 5. TỔNG coinBalance THEO ROLE ════════');
  const byRole = await prisma.user.groupBy({
    by: ['role'],
    _sum: { coinBalance: true },
    _count: true,
    _avg: { coinBalance: true },
  });
  for (const r of byRole) {
    console.log(`  ${r.role.padEnd(10)} count=${String(r._count).padStart(4)}  total=${(r._sum.coinBalance ?? 0).toLocaleString().padStart(10)}  avg=${(r._avg.coinBalance ?? 0).toFixed(1).padStart(10)}`);
  }

  // 6) Top 10 user có nhiều deposit nhất (kiểm tra xem có bất thường)
  console.log('\n════════ 6. TOP 10 USER CÓ NHIỀU DEPOSIT NHẤT ════════');
  const topDepositors = await prisma.user.findMany({
    select: {
      id: true, email: true, role: true, coinBalance: true,
      _count: { select: { deposits: true, purchases: true } },
    },
    orderBy: { deposits: { _count: 'desc' } },
    take: 10,
  });
  for (const u of topDepositors) {
    console.log(`  deposits=${String(u._count.deposits).padStart(3)}  purchases=${String(u._count.purchases).padStart(4)}  ${u.email.padEnd(40)} [${u.role}] coinBalance=${u.coinBalance.toLocaleString()}`);
  }

  // 7) Tổng deposit đã approved
  console.log('\n════════ 7. THỐNG KÊ DEPOSIT ════════');
  const depositStats = await prisma.deposit.groupBy({
    by: ['status'],
    _sum: { amount: true, coins: true },
    _count: true,
  });
  for (const d of depositStats) {
    console.log(`  status=${d.status.padEnd(10)}  count=${String(d._count).padStart(4)}  totalAmount=${(d._sum.amount ?? 0).toLocaleString().padStart(10)} VND  totalCoins=${(d._sum.coins ?? 0).toLocaleString().padStart(10)}`);
  }

  // 8) User đăng ký cùng phút nhiều nhất
  console.log('\n════════ 8. TOP 10 BURST SIGNUPS (cùng phút) ════════');
  const allUsers = await prisma.user.findMany({
    select: { id: true, email: true, role: true, createdAt: true, provider: true, emailVerified: true },
  });
  const byMinute = new Map<string, typeof allUsers>();
  for (const u of allUsers) {
    const key = new Date(Math.floor(u.createdAt.getTime() / 60000) * 60000).toISOString();
    const arr = byMinute.get(key) ?? [];
    arr.push(u);
    byMinute.set(key, arr);
  }
  const bursts = [...byMinute.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
  for (const [minute, arr] of bursts) {
    if (arr.length < 3) break;
    console.log(`  ${minute.slice(0, 19)} UTC  → ${arr.length} user:`);
    for (const u of arr.slice(0, 8)) {
      console.log(`     [${u.role.padEnd(9)}] ${u.email.padEnd(40)} provider=${u.provider} verified=${u.emailVerified}`);
    }
    if (arr.length > 8) console.log(`     ... +${arr.length - 8} khác`);
  }

  // 9) User tự có email pattern giống test/spam
  console.log('\n════════ 9. USER CÓ TÊN/EMAIL NGHI LÀ TEST/SPAM/BOT ════════');
  const spamRegex = /^(test|spam|bot|asdf|qwerty|xxx|fake|demo|user+\d|abc|admin\s|mod\s)/i;
  for (const u of allUsers) {
    if (spamRegex.test(u.name ?? '') || spamRegex.test(u.email.split('@')[0])) {
      console.log(`  [${u.role.padEnd(9)}] ${u.email.padEnd(40)} name='${u.name}'`);
    }
  }

  // 10) Kiểm tra user có cùng image (avatar) — gợi ý clone
  console.log('\n════════ 10. USER CHIA SẺ CÙNG AVATAR URL ════════');
  const usersWithImage = await prisma.user.findMany({
    where: { image: { not: null } },
    select: { id: true, email: true, image: true },
  });
  const imgMap = new Map<string, typeof usersWithImage>();
  for (const u of usersWithImage) {
    if (!u.image) continue;
    const arr = imgMap.get(u.image) ?? [];
    arr.push(u);
    imgMap.set(u.image, arr);
  }
  const shared = [...imgMap.entries()].filter(([, arr]) => arr.length > 1).sort((a, b) => b[1].length - a[1].length);
  for (const [img, arr] of shared.slice(0, 10)) {
    console.log(`  ${arr.length} user dùng chung:`);
    console.log(`    ${img.slice(0, 100)}`);
    for (const u of arr) {
      console.log(`      - ${u.email}`);
    }
  }
}

main()
  .catch((e) => { console.error('❌', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });