import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function trace(email: string) {
  console.log(`\n========== TRUY VET CHO ${email} ==========`);
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u) { console.log('Khong tim thay user'); return; }
  console.log(`id=${u.id}  role=${u.role}  coinBalance=${u.coinBalance}  createdAt=${u.createdAt.toISOString().slice(0,19)}`);

  const [deposits, credits, earnings, readerGifts, sentGifts, purchases, adRewards, authorAdEarnings, dailyQuests, referralEarnings, withdrawals, adsAsAuthor, comments] = await Promise.all([
    prisma.deposit.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } }),
    prisma.adminCoinCredit.findMany({ where: { authorId: u.id } }),
    prisma.authorEarning.findMany({ where: { authorId: u.id }, orderBy: { createdAt: 'asc' } }),
    prisma.giftTransaction.findMany({ where: { receiverId: u.id } }),
    prisma.giftTransaction.findMany({ where: { senderId: u.id } }),
    prisma.chapterPurchase.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' }, include: { chapter: { select: { title: true, number: true } } } }),
    prisma.adReward.findMany({ where: { userId: u.id }, orderBy: { watchedAt: 'asc' } }),
    prisma.authorAdEarning.findMany({ where: { authorId: u.id } }),
    prisma.dailyQuest.findMany({ where: { userId: u.id }, orderBy: { date: 'asc' } }),
    prisma.referralEarning.findMany({ where: { OR: [{ referrerId: u.id }, { fromUserId: u.id }] } }),
    prisma.withdrawal.findMany({ where: { userId: u.id } }),
    prisma.authorAdLog.findMany({ where: { authorId: u.id } }),
    prisma.comment.count({ where: { userId: u.id } }),
  ]);

  console.log(`\n[+] DEPOSITS (nạp xu, status=approved):`);
  for (const d of deposits) {
    if (d.status === 'approved') console.log(`    ${d.createdAt.toISOString().slice(0,19)}  +${d.coins.toString().padStart(6)} xu  ${d.method}  status=${d.status}`);
  }

  console.log(`\n[+] AdminCoinCredit:`);
  for (const c of credits) console.log(`    ${c.createdAt.toISOString().slice(0,19)}  ${c.amount >= 0 ? '+' : ''}${c.amount.toString().padStart(6)} xu  reason='${c.reason.slice(0,50)}'`);

  console.log(`\n[+] AuthorEarnings (tac gia nhan):`);
  let sumE = 0;
  for (const e of earnings) {
    console.log(`    ${e.createdAt.toISOString().slice(0,19)}  +${e.amount.toString().padStart(6)} xu  type=${e.type}  ch=${e.chapterTitle?.slice(0,30) ?? '-'}`);
    sumE += e.amount;
  }
  console.log(`    -> Total: +${sumE}`);

  console.log(`\n[+] ReaderGifts (nhan qua):`);
  for (const g of readerGifts) console.log(`    ${g.createdAt.toISOString().slice(0,19)}  +${g.totalCoins.toString().padStart(5)} xu  qty=${g.quantity}`);

  console.log(`\n[-] ChapterPurchases (mua chuong):`);
  let sumP = 0;
  for (const p of purchases) {
    console.log(`    ${p.createdAt.toISOString().slice(0,19)}  -${p.coins.toString().padStart(4)} xu  ch#${p.chapter.number} '${p.chapter.title.slice(0,30)}'`);
    sumP += p.coins;
  }
  console.log(`    -> Total: -${sumP}  (${purchases.length} lan mua)`);

  console.log(`\n[-] SentGifts (tang qua, author bi tru?):`);
  let sumSG = 0;
  for (const g of sentGifts) { console.log(`    ${g.createdAt.toISOString().slice(0,19)}  -${g.totalCoins.toString().padStart(4)} xu  qty=${g.quantity}`); sumSG += g.totalCoins; }
  console.log(`    -> Total: -${sumSG}`);

  console.log(`\n[+] AdRewards:`);
  let sumAR = 0;
  for (const a of adRewards) { console.log(`    ${a.watchedAt.toISOString().slice(0,19)}  +${a.coins.toString().padStart(4)} xu`); sumAR += a.coins; }
  console.log(`    -> Total: +${sumAR}`);

  console.log(`\n[+] DailyQuests:`);
  let sumDQ = 0;
  for (const d of dailyQuests) { console.log(`    ${d.date}  +${d.coinsEarned.toString().padStart(4)} xu  checkin=${d.checkin} readMin=${d.readMinutes} ads=${d.adsWatched}`); sumDQ += d.coinsEarned; }
  console.log(`    -> Total: +${sumDQ}`);

  console.log(`\n[+] ReferralEarnings (referrer):`);
  for (const r of referralEarnings) console.log(`    ${r.createdAt.toISOString().slice(0,19)}  +${r.amount.toString().padStart(5)} xu  type=${r.type}`);

  // Tinh toan
  const depositCoins = deposits.filter(d => d.status === 'approved').reduce((s, d) => s + d.coins, 0);
  const creditCoins = credits.reduce((s, c) => s + c.amount, 0);
  const earningsCoins = sumE;
  const giftCoins = readerGifts.reduce((s, g) => s + g.totalCoins, 0);
  const adCoins = sumAR;
  const questCoins = sumDQ;
  const adAuthorCoins = authorAdEarnings.reduce((s, a) => s + a.earnings, 0);
  const refCoins = referralEarnings.reduce((s, r) => s + r.amount, 0);

  const spentOnPurchases = sumP;
  const spentOnGifts = sumSG;

  const netChange = (depositCoins + creditCoins + earningsCoins + giftCoins + adCoins + questCoins + adAuthorCoins + refCoins)
                   - (spentOnPurchases + spentOnGifts);
  const orphan = u.coinBalance - netChange;

  console.log(`\n========== TONG KET ==========`);
  console.log(`Tong CONG: deposit=${depositCoins} + adminCredit=${creditCoins} + earnings=${earningsCoins} + giftsNhan=${giftCoins} + adReward=${adCoins} + quest=${questCoins} + adAuthorEarning=${adAuthorCoins} + referralEarning=${refCoins}`);
  console.log(`Tong TRU:  purchases=${spentOnPurchases} + giftsTang=${spentOnGifts}`);
  console.log(`Net expected coinBalance: ${netChange}`);
  console.log(`coinBalance thuc te:      ${u.coinBalance}`);
  console.log(`ORPHAN (lech):            ${orphan}  ${orphan === 0 ? 'OK' : 'CAN KIEM TRA'}`);
}

async function main() {
  await trace('nguyenthuhung057@gmail.com');
  await trace('roseice3574@gmail.com');
  await trace('thuhang0587@gmail.com');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });