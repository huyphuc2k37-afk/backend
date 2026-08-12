import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔎 ĐÀO SÂU CÁC ĐIỂM NGHI VẤN NGHIÊM TRỌNG\n');

  // 1) Tất cả user có email dạng den.tigrmail.com
  console.log('════════ 1. USER @den.tigrmail.com (spam domain) ════════');
  const spam = await prisma.user.findMany({
    where: { email: { contains: '@den.tigrmail.com' } },
    select: {
      id: true, name: true, email: true, role: true, coinBalance: true,
      createdAt: true, emailVerified: true, provider: true,
      _count: { select: { comments: true, bookmarks: true, readHistory: true, purchases: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`  Tổng ${spam.length} user.`);
  for (const u of spam) {
    console.log(`  ${u.createdAt.toISOString().slice(0, 19)}  [${u.role.padEnd(9)}] ${u.email.padEnd(45)}  verif=${u.emailVerified}  coin=${u.coinBalance}  c=${u._count.comments} b=${u._count.bookmarks} rh=${u._count.readHistory}`);
  }

  // 2) Tất cả user provider=email — kiểm tra xem họ dùng domain gì
  console.log('\n════════ 2. TẤT CẢ USER provider=email ════════');
  const emailUsers = await prisma.user.findMany({
    where: { provider: 'email' },
    select: { id: true, name: true, email: true, role: true, coinBalance: true, createdAt: true, emailVerified: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`  Tổng ${emailUsers.length} user provider=email.`);
  const domainMap = new Map<string, number>();
  for (const u of emailUsers) {
    const d = u.email.split('@')[1] ?? 'unknown';
    domainMap.set(d, (domainMap.get(d) ?? 0) + 1);
  }
  console.log('  Phân bố domain:');
  for (const [d, n] of [...domainMap.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    @${d.padEnd(30)} ${n}`);
  }

  // 3) Kiểm tra AdminCoinCredit với senderId=NULL hoặc không rõ
  console.log('\n════════ 3. AdminCoinCredit records ════════');
  const credits = await prisma.adminCoinCredit.count();
  console.log(`  Tổng ${credits} records trong bảng AdminCoinCredit.`);
  if (credits === 0) {
    console.log('  → Tất cả coinBalance >0 đều không qua audit log admin!');
  }

  // 4) Tìm user có referralEarnings cao bất thường
  console.log('\n════════ 4. TOP USER CÓ referralEarnings ════════');
  const topRefs = await prisma.user.findMany({
    select: {
      id: true, email: true, role: true, coinBalance: true,
      referralCode: true,
      _count: { select: { referralEarnings: true, referrals: true } },
    },
    orderBy: { referralEarnings: { _count: 'desc' } },
    take: 10,
  });
  for (const u of topRefs) {
    console.log(`  refEarnings=${String(u._count.referralEarnings).padStart(3)}  referrals=${String(u._count.referrals).padStart(2)}  ${u.email.padEnd(40)} [${u.role}] refCode=${u.referralCode ?? '-'} coinBalance=${u.coinBalance.toLocaleString()}`);
  }

  // 5) User có email gần giống nhau (typo squatting hoặc impersonation)
  console.log('\n════════ 5. CÁC CỤM EMAIL GIỐNG NHAU (kiểm tra impersonation) ════════');
  const all = await prisma.user.findMany({ select: { id: true, email: true, role: true, coinBalance: true, createdAt: true, emailVerified: true } });
  const localMap = new Map<string, typeof all>();
  for (const u of all) {
    const local = u.email.split('@')[0].toLowerCase().replace(/[._+0-9]/g, '');
    if (local.length < 4) continue;
    const arr = localMap.get(local) ?? [];
    arr.push(u);
    localMap.set(local, arr);
  }
  const groups = [...localMap.entries()].filter(([, arr]) => arr.length > 1 && new Set(arr.map((u) => u.email)).size > 1).sort((a, b) => b[1].length - a[1].length);
  for (const [local, arr] of groups.slice(0, 15)) {
    console.log(`\n  Cụm local-part="${local}" (${arr.length} user):`);
    for (const u of arr) {
      console.log(`    [${u.role.padEnd(9)}] ${u.email.padEnd(45)}  coin=${u.coinBalance.toLocaleString().padStart(7)}  verif=${u.emailVerified}  createdAt=${u.createdAt.toISOString().slice(0, 10)}`);
    }
  }

  // 6) Kiểm tra admin "seringuyen0506@gmail.com" chi tiết
  console.log('\n════════ 6. CHI TIẾT ADMIN seringuyen0506@gmail.com ════════');
  const adminAccts = await prisma.user.findMany({
    where: { email: { contains: 'seringuyen' } },
    select: { id: true, name: true, email: true, role: true, isSuperMod: true, coinBalance: true, createdAt: true, updatedAt: true, emailVerified: true, provider: true },
  });
  for (const a of adminAccts) {
    console.log(`  [${a.role.padEnd(9)}] ${a.email.padEnd(40)}  name='${a.name}'  isSuperMod=${a.isSuperMod}  coin=${a.coinBalance}  verif=${a.emailVerified}  provider=${a.provider}`);
    console.log(`     id=${a.id}  created=${a.createdAt.toISOString().slice(0, 19)}  updated=${a.updatedAt.toISOString().slice(0, 19)}`);
  }

  // 7) Tất cả user có email giống admin
  console.log('\n════════ 7. USER CÓ TÊN GIỐNG/SÁT ADMIN ════════');
  const adminEmails = (await prisma.user.findMany({ where: { role: 'admin' }, select: { email: true } })).map((u) => u.email);
  for (const ae of adminEmails) {
    const local = ae.split('@')[0];
    const matches = await prisma.user.findMany({
      where: {
        OR: [
          { email: { startsWith: local + '.', mode: 'insensitive' } },
          { email: { startsWith: local + '+', mode: 'insensitive' } },
          { email: { startsWith: local + '0', mode: 'insensitive' } },
          { email: { startsWith: local + '1', mode: 'insensitive' } },
          { email: { startsWith: local + '2', mode: 'insensitive' } },
          { email: { startsWith: local + '99', mode: 'insensitive' } },
        ],
        email: { not: ae },
      },
      select: { id: true, email: true, role: true, coinBalance: true, createdAt: true },
    });
    if (matches.length > 0) {
      console.log(`\n  Admin email: ${ae}  → ${matches.length} email "sát":`);
      for (const m of matches) {
        console.log(`    [${m.role.padEnd(9)}] ${m.email.padEnd(45)} coin=${m.coinBalance.toLocaleString()}  createdAt=${m.createdAt.toISOString().slice(0, 10)}`);
      }
    }
  }

  // 8) Tìm user tên/email có pattern test/spam nhưng không match trước đó
  console.log('\n════════ 8. USER CÓ BIO hoặc name ngắn/lạ ════════');
  const bioUsers = await prisma.user.findMany({
    where: { OR: [{ bio: { not: null } }, { name: { in: ['test', 'admin', 'user', 'a', 'aa', 'aaa', 'asd', 'asdf', 'qwerty', '123', 'abc'] } }] },
    select: { id: true, name: true, email: true, role: true, bio: true, coinBalance: true, createdAt: true },
  });
  console.log(`  Tổng ${bioUsers.length} user có bio hoặc tên đáng ngờ.`);
  for (const u of bioUsers.slice(0, 15)) {
    console.log(`  [${u.role.padEnd(9)}] ${u.email.padEnd(40)} name='${u.name}' bio=${(u.bio ?? '').slice(0, 50)}`);
  }

  // 9) User có coinBalance >0 nhưng không có deposit/purchase/creditsReceived/gift/payout/earning
  console.log('\n════════ 9. USER CÓ coinBalance >0 NHƯNG "KHÔNG CÓ NGUỒN" ════════');
  const users = await prisma.user.findMany({
    where: { coinBalance: { gt: 0 } },
    select: {
      id: true, email: true, role: true, coinBalance: true, createdAt: true,
      _count: {
        select: {
          deposits: true, purchases: true, withdrawals: true,
          sentGifts: true, receivedGifts: true,
          coinCreditsReceived: true, earnings: true, paidSuggestions: true,
        },
      },
    },
  });
  const orphans = users.filter((u) =>
    u._count.deposits === 0 && u._count.coinCreditsReceived === 0
    && (u.role !== 'reader' || (u._count.purchases === 0 && u._count.receivedGifts === 0))
  );
  console.log(`  Tổng ${orphans.length} user có coinBalance >0 nhưng thiếu nguồn rõ ràng.`);
  for (const u of orphans) {
    console.log(`  ${u.coinBalance.toString().padStart(7)} xu  [${u.role.padEnd(9)}] ${u.email.padEnd(40)} dep=${u._count.deposits} pur=${u._count.purchases} wd=${u._count.withdrawals} gft=${u._count.sentGifts}+${u._count.receivedGifts} cr=${u._count.coinCreditsReceived} earn=${u._count.earnings}`);
  }

  // 10) Kiểm tra withdrawal — user có yêu cầu rút tiền
  console.log('\n════════ 10. WITHDRAWAL ════════');
  const withdrawals = await prisma.withdrawal.findMany({
    include: { user: { select: { email: true, role: true, coinBalance: true } } },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`  Tổng ${withdrawals.length} withdrawal.`);
  for (const w of withdrawals) {
    console.log(`  ${w.createdAt.toISOString().slice(0, 19)}  status=${w.status.padEnd(10)}  ${w.amount.toString().padStart(6)} xu / ${w.moneyAmount.toString().padStart(7)} VND  ${w.user.email.padEnd(40)} [${w.user.role}] coinBalance=${w.user.coinBalance.toLocaleString()}`);
  }

  // 11) BannedEmail
  console.log('\n════════ 11. BannedEmail ════════');
  const banned = await prisma.bannedEmail.findMany({ orderBy: { createdAt: 'desc' } });
  console.log(`  Tổng ${banned.length} email bị ban.`);
  for (const b of banned.slice(0, 20)) {
    console.log(`  ${b.createdAt.toISOString().slice(0, 19)}  ${b.email.padEnd(40)}  reason='${b.reason ?? ''}'  bannedBy='${b.bannedBy ?? ''}'`);
  }
}

main()
  .catch((e) => { console.error('❌', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });