import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const u = await p.user.findUnique({ where: { email: 'roseice3574@gmail.com' } });
  if (!u) { console.log('not found'); return; }

  // Tất cả các bảng có thể liên quan
  const tables: any = {
    deposits: await p.deposit.findMany({ where: { userId: u.id } }),
    credits: await p.adminCoinCredit.findMany({ where: { authorId: u.id } }),
    earningsReceived: await p.authorEarning.findMany({ where: { authorId: u.id } }),
    readerGiftsReceived: await p.giftTransaction.findMany({ where: { receiverId: u.id } }),
    giftsSent: await p.giftTransaction.findMany({ where: { senderId: u.id } }),
    purchases: await p.chapterPurchase.findMany({ where: { userId: u.id } }),
    adRewards: await p.adReward.findMany({ where: { userId: u.id } }),
    adAuthorEarnings: await p.authorAdEarning.findMany({ where: { authorId: u.id } }),
    quests: await p.dailyQuest.findMany({ where: { userId: u.id } }),
    refEarnings: await p.referralEarning.findMany({ where: { referrerId: u.id } }),
    refFromEarnings: await p.referralEarning.findMany({ where: { fromUserId: u.id } }),
    withdrawals: await p.withdrawal.findMany({ where: { userId: u.id } }),
    suggestions: await p.paidSuggestion.findMany({ where: { userId: u.id } }),
    fanClubs: await p.fanClub.findMany({ where: { authorId: u.id } }),
    tipsAuthor: await p.authorEarning.findMany({ where: { authorId: u.id, type: 'tip' } }),
    earningsFromUser: await p.authorEarning.findMany({ where: { fromUserId: u.id } }),
  };
  console.log(`User ${u.email}  coinBalance=${u.coinBalance}`);
  for (const [k, v] of Object.entries(tables)) {
    console.log(`  ${k}: ${(v as any[]).length} records`);
    for (const r of (v as any[]).slice(0, 3)) {
      console.log(`     ${JSON.stringify(r).slice(0, 200)}`);
    }
  }

  // Cộng dồn xu
  const dep = tables.deposits.filter((d: any) => d.status === 'approved').reduce((s: number, d: any) => s + d.coins, 0);
  const cred = tables.credits.reduce((s: number, c: any) => s + c.amount, 0);
  const earnR = tables.earningsReceived.reduce((s: number, e: any) => s + e.amount, 0);
  const earnFromUser = tables.earningsFromUser.reduce((s: number, e: any) => s + e.amount, 0);
  const giftR = tables.readerGiftsReceived.reduce((s: number, g: any) => s + g.totalCoins, 0);
  const giftS = tables.giftsSent.reduce((s: number, g: any) => s + g.totalCoins, 0);
  const purch = tables.purchases.reduce((s: number, p2: any) => s + p2.coins, 0);
  const adR = tables.adRewards.reduce((s: number, a: any) => s + a.coins, 0);
  const adAuth = tables.adAuthorEarnings.reduce((s: number, a: any) => s + a.earnings, 0);
  const q = tables.quests.reduce((s: number, d: any) => s + d.coinsEarned, 0);
  const refR = tables.refEarnings.reduce((s: number, r: any) => s + r.amount, 0);
  const refF = tables.refFromEarnings.reduce((s: number, r: any) => s + r.amount, 0);
  const wd = tables.withdrawals.filter((w: any) => w.status === 'approved' || w.status === 'pending').reduce((s: number, w: any) => s + w.amount, 0);
  const sugg = tables.suggestions.reduce((s: number, su: any) => s + su.coinsSpent, 0);

  console.log(`\n  deposits(approved): +${dep}`);
  console.log(`  adminCredit:        +${cred}`);
  console.log(`  earningsReceived:   +${earnR}  (là tác giả nhận)`);
  console.log(`  earningsFromUser:   +${earnFromUser}  (user là fromUser, tức mua chapter/tip - KHÔNG tính vào coinBalance của user này)`);
  console.log(`  giftsReceived:      +${giftR}`);
  console.log(`  giftsSent:          -${giftS}`);
  console.log(`  purchases:          -${purch}`);
  console.log(`  adRewards:          +${adR}`);
  console.log(`  adAuthorEarnings:   +${adAuth}`);
  console.log(`  quests:             +${q}`);
  console.log(`  refEarnings(referrer): +${refR}`);
  console.log(`  refEarnings(fromUser):  -${refF}  ← user này là fromUser, referrer được cộng`);
  console.log(`  withdrawals:        -${wd}  (xu bị trừ tạm)`);
  console.log(`  paidSuggestions:    -${sugg}`);

  const totalIn = dep + cred + earnR + giftR + adR + adAuth + q + refR;
  const totalOut = purch + giftS + refF + wd + sugg;
  const net = totalIn - totalOut;
  console.log(`\n  IN:  ${totalIn}`);
  console.log(`  OUT: ${totalOut}`);
  console.log(`  Net: ${net}`);
  console.log(`  coinBalance thực tế: ${u.coinBalance}`);
  console.log(`  LỆCH: ${u.coinBalance - net}`);
  await p.$disconnect();
})();