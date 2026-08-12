import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Gmail dot-trick / plus-tag normalization.
 * Should match the production logic in src/routes/authRoutes.ts.
 */
function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().trim().split('@');
  if (!local || !domain) return email.toLowerCase().trim();
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const cleaned = local.replace(/\./g, '').replace(/\+.*$/, '');
    return `${cleaned}@gmail.com`;
  }
  return `${local}@${domain}`;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', 'guerrillamail.com', '10minutemail.com',
  'trashmail.com', 'yopmail.com', 'fakeinbox.com', 'throwawaymail.com',
  'maildrop.cc', 'sharklasers.com', 'getairmail.com', 'temp-mail.org',
]);

interface AnomalyRow {
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: string;
  userId: string;
  email: string;
  detail: string;
}

async function main() {
  console.log('🔍 Đang tải toàn bộ user từ database...\n');

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isSuperMod: true,
      provider: true,
      emailVerified: true,
      coinBalance: true,
      referralCode: true,
      referredById: true,
      image: true,
      bio: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          stories: true,
          comments: true,
          bookmarks: true,
          readHistory: true,
          deposits: true,
          purchases: true,
          withdrawals: true,
          sentGifts: true,
          receivedGifts: true,
          paidSuggestions: true,
          followers: true,
          following: true,
          authorBadges: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`📊 Tổng số user: ${users.length}\n`);

  // ─── Thống kê tổng quan ───
  const byRole: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  let totalCoins = 0;
  let negativeCoins = 0;
  let hugeCoins = 0;
  for (const u of users) {
    byRole[u.role] = (byRole[u.role] ?? 0) + 1;
    byProvider[u.provider] = (byProvider[u.provider] ?? 0) + 1;
    totalCoins += u.coinBalance;
    if (u.coinBalance < 0) negativeCoins++;
    if (u.coinBalance > 1_000_000) hugeCoins++;
  }

  console.log('─── Phân bố role ───');
  for (const [k, v] of Object.entries(byRole).sort()) console.log(`  ${k.padEnd(12)} ${v}`);
  console.log('─── Phân bố provider ───');
  for (const [k, v] of Object.entries(byProvider).sort()) console.log(`  ${k.padEnd(12)} ${v}`);
  console.log(`\nTổng coinBalance trong hệ thống: ${totalCoins.toLocaleString()}`);
  console.log(`User có coinBalance âm: ${negativeCoins}`);
  console.log(`User có coinBalance > 1,000,000: ${hugeCoins}\n`);

  // ─── Phát hiện bất thường ───
  const anomalies: AnomalyRow[] = [];

  // 1) Email trùng sau khi normalize (Gmail dot/plus bypass)
  const normalizedMap = new Map<string, typeof users>();
  for (const u of users) {
    const norm = normalizeEmail(u.email);
    const arr = normalizedMap.get(norm) ?? [];
    arr.push(u);
    normalizedMap.set(norm, arr);
  }
  for (const [norm, arr] of normalizedMap) {
    if (arr.length > 1) {
      const distinctOriginal = Array.from(new Set(arr.map((a) => a.email)));
      if (distinctOriginal.length > 1) {
        anomalies.push({
          severity: 'HIGH',
          category: 'duplicate-email-after-normalize',
          userId: arr.map((u) => u.id).join(', '),
          email: distinctOriginal.join(' | '),
          detail: `Normalized '${norm}' có ${arr.length} user với ${distinctOriginal.length} email khác nhau`,
        });
      }
    }
  }

  // 2) Email không hợp lệ về mặt kỹ thuật
  for (const u of users) {
    if (!EMAIL_REGEX.test(u.email)) {
      anomalies.push({
        severity: 'HIGH',
        category: 'invalid-email-format',
        userId: u.id,
        email: u.email,
        detail: `Email không hợp lệ`,
      });
    }
  }

  // 3) Email từ domain không phải Gmail trong khi policy đăng ký chỉ cho phép Gmail/Google
  for (const u of users) {
    const domain = u.email.split('@')[1]?.toLowerCase();
    if (!domain) continue;
    if (u.provider === 'google' && domain !== 'gmail.com' && domain !== 'googlemail.com') {
      anomalies.push({
        severity: 'MEDIUM',
        category: 'non-gmail-google-account',
        userId: u.id,
        email: u.email,
        detail: `Provider=google nhưng domain=${domain} (không phải Gmail)`,
      });
    }
    if (DISPOSABLE_DOMAINS.has(domain)) {
      anomalies.push({
        severity: 'HIGH',
        category: 'disposable-email-domain',
        userId: u.id,
        email: u.email,
        detail: `Email thuộc dịch vụ disposable/temp mail`,
      });
    }
  }

  // 4) Role không hợp lệ (không nằm trong enum ngầm định)
  const VALID_ROLES = new Set(['reader', 'author', 'moderator', 'admin']);
  for (const u of users) {
    if (!VALID_ROLES.has(u.role)) {
      anomalies.push({
        severity: 'HIGH',
        category: 'invalid-role',
        userId: u.id,
        email: u.email,
        detail: `Role '${u.role}' không thuộc whitelist`,
      });
    }
  }

  // 5) Quá nhiều admin/moderator (cờ cảnh báo)
  const admins = users.filter((u) => u.role === 'admin');
  const mods = users.filter((u) => u.role === 'moderator');
  const superMods = users.filter((u) => u.isSuperMod);
  console.log(`Admin: ${admins.length} | Moderator: ${mods.length} | SuperMod (isSuperMod=true): ${superMods.length}`);
  if (admins.length > 5) {
    anomalies.push({
      severity: 'MEDIUM',
      category: 'too-many-admins',
      userId: '-',
      email: '-',
      detail: `Có ${admins.length} tài khoản admin — kiểm tra lại`,
    });
  }
  for (const u of superMods) {
    if (u.role !== 'moderator' && u.role !== 'admin') {
      anomalies.push({
        severity: 'HIGH',
        category: 'supermod-flag-on-non-staff',
        userId: u.id,
        email: u.email,
        detail: `isSuperMod=true nhưng role='${u.role}'`,
      });
    }
  }

  // 6) emailVerified=false đã lâu (> 7 ngày) và provider=email
  const now = new Date();
  for (const u of users) {
    if (u.emailVerified) continue;
    const ageDays = (now.getTime() - u.createdAt.getTime()) / 86400000;
    if (ageDays > 7) {
      anomalies.push({
        severity: 'LOW',
        category: 'stale-unverified',
        userId: u.id,
        email: u.email,
        detail: `Chưa xác thực email sau ${ageDays.toFixed(0)} ngày (createdAt=${u.createdAt.toISOString().slice(0, 10)})`,
      });
    }
  }

  // 7) Provider không hợp lệ
  for (const u of users) {
    if (!['google', 'email'].includes(u.provider)) {
      anomalies.push({
        severity: 'HIGH',
        category: 'invalid-provider',
        userId: u.id,
        email: u.email,
        detail: `Provider='${u.provider}' không nằm trong {google, email}`,
      });
    }
  }

  // 8) Thiếu tên / tên rác
  for (const u of users) {
    const name = (u.name ?? '').trim();
    if (!name) {
      anomalies.push({
        severity: 'MEDIUM',
        category: 'empty-name',
        userId: u.id,
        email: u.email,
        detail: `Tên trống`,
      });
    } else if (name.length < 2) {
      anomalies.push({
        severity: 'LOW',
        category: 'very-short-name',
        userId: u.id,
        email: u.email,
        detail: `Tên chỉ có ${name.length} ký tự: '${name}'`,
      });
    } else if (/(test|spam|bot|asdf|qwerty|xxx)/i.test(name)) {
      anomalies.push({
        severity: 'MEDIUM',
        category: 'suspicious-name',
        userId: u.id,
        email: u.email,
        detail: `Tên có vẻ spam/test: '${name}'`,
      });
    }
  }

  // 9) CoinBalance âm hoặc cực lớn
  for (const u of users) {
    if (u.coinBalance < 0) {
      anomalies.push({
        severity: 'HIGH',
        category: 'negative-coin-balance',
        userId: u.id,
        email: u.email,
        detail: `coinBalance=${u.coinBalance}`,
      });
    }
    if (u.coinBalance > 10_000_000) {
      anomalies.push({
        severity: 'MEDIUM',
        category: 'huge-coin-balance',
        userId: u.id,
        email: u.email,
        detail: `coinBalance=${u.coinBalance.toLocaleString()} (>10M)`,
      });
    }
  }

  // 10) ReferralCode trùng
  const refMap = new Map<string, typeof users[number][]>();
  for (const u of users) {
    if (!u.referralCode) continue;
    const arr = refMap.get(u.referralCode) ?? [];
    arr.push(u);
    refMap.set(u.referralCode, arr);
  }
  for (const [code, arr] of refMap) {
    if (arr.length > 1) {
      anomalies.push({
        severity: 'HIGH',
        category: 'duplicate-referral-code',
        userId: arr.map((u) => u.id).join(', '),
        email: arr.map((u) => u.email).join(' | '),
        detail: `Cùng referralCode='${code}' được dùng bởi ${arr.length} user`,
      });
    }
  }

  // 11) ReferredById trỏ đến user không tồn tại
  const userIds = new Set(users.map((u) => u.id));
  for (const u of users) {
    if (u.referredById && !userIds.has(u.referredById)) {
      anomalies.push({
        severity: 'HIGH',
        category: 'dangling-referredBy',
        userId: u.id,
        email: u.email,
        detail: `referredById='${u.referredById}' không tồn tại`,
      });
    }
  }

  // 12) User tự giới thiệu chính mình
  for (const u of users) {
    if (u.referredById && u.referredById === u.id) {
      anomalies.push({
        severity: 'HIGH',
        category: 'self-referral',
        userId: u.id,
        email: u.email,
        detail: `referredById trùng với id của chính user`,
      });
    }
  }

  // 13) User không hoạt động nhưng có coinBalance cao
  for (const u of users) {
    const activity = u._count.stories + u._count.comments + u._count.bookmarks
      + u._count.readHistory + u._count.deposits + u._count.purchases
      + u._count.sentGifts + u._count.paidSuggestions;
    if (activity === 0 && u.coinBalance > 5000) {
      anomalies.push({
        severity: 'MEDIUM',
        category: 'dormant-with-coins',
        userId: u.id,
        email: u.email,
        detail: `0 hoạt động nhưng coinBalance=${u.coinBalance.toLocaleString()}`,
      });
    }
  }

  // 14) author role nhưng có 0 truyện và hoạt động thấp
  for (const u of users) {
    if (u.role === 'author' && u._count.stories === 0 && u.coinBalance === 0) {
      anomalies.push({
        severity: 'LOW',
        category: 'author-no-stories',
        userId: u.id,
        email: u.email,
        detail: `Role=author nhưng 0 truyện và 0 coin`,
      });
    }
  }

  // 15) Trùng image (avatar URL) — gợi ý clone/spam
  const imageMap = new Map<string, string[]>();
  for (const u of users) {
    if (!u.image) continue;
    const arr = imageMap.get(u.image) ?? [];
    arr.push(u.id);
    imageMap.set(u.image, arr);
  }
  for (const [img, ids] of imageMap) {
    if (ids.length > 1) {
      anomalies.push({
        severity: 'LOW',
        category: 'shared-avatar',
        userId: ids.join(', '),
        email: '-',
        detail: `${ids.length} user dùng chung 1 avatar URL`,
      });
    }
  }

  // 16) User cùng IP tạo trong khoảng thời gian ngắn (qua ViewLog userId fingerprint)
  // Đơn giản: lấy user có createdAt trong cùng 1 phút với user khác trở lên
  const byMinute = new Map<string, typeof users>();
  for (const u of users) {
    const key = new Date(u.createdAt.getTime() - (u.createdAt.getTime() % 60000)).toISOString();
    const arr = byMinute.get(key) ?? [];
    arr.push(u);
    byMinute.set(key, arr);
  }
  let burstCount = 0;
  for (const [minute, arr] of byMinute) {
    if (arr.length >= 5) {
      burstCount++;
      if (burstCount <= 10) {
        anomalies.push({
          severity: 'LOW',
          category: 'burst-signups',
          userId: `${arr.length} users`,
          email: arr.slice(0, 3).map((u) => u.email).join(', ') + (arr.length > 3 ? ', ...' : ''),
          detail: `${arr.length} user được tạo trong cùng phút ${minute.slice(0, 16)}`,
        });
      }
    }
  }

  // ─── In kết quả ───
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log(`🚨 TỔNG SỐ BẤT THƯỜNG PHÁT HIỆN: ${anomalies.length}`);
  console.log('════════════════════════════════════════════════════════════════════\n');

  const bySeverity = { HIGH: [] as AnomalyRow[], MEDIUM: [] as AnomalyRow[], LOW: [] as AnomalyRow[], INFO: [] as AnomalyRow[] };
  for (const a of anomalies) bySeverity[a.severity].push(a);
  console.log(`  HIGH   : ${bySeverity.HIGH.length}`);
  console.log(`  MEDIUM : ${bySeverity.MEDIUM.length}`);
  console.log(`  LOW    : ${bySeverity.LOW.length}`);
  console.log(`  INFO   : ${bySeverity.INFO.length}\n`);

  const grouped: Record<string, AnomalyRow[]> = {};
  for (const a of anomalies) {
    grouped[a.category] = grouped[a.category] ?? [];
    grouped[a.category].push(a);
  }

  for (const [cat, rows] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n─── [${rows[0].severity}] ${cat} (${rows.length}) ───`);
    const show = rows.slice(0, 20);
    for (const r of show) {
      console.log(`  • ${r.userId === '-' ? '-' : `id=${r.userId}`}`);
      console.log(`    email : ${r.email}`);
      console.log(`    detail: ${r.detail}`);
    }
    if (rows.length > show.length) console.log(`  ... và ${rows.length - show.length} trường hợp khác`);
  }

  // ─── Top 20 user có coin cao nhất (tham khảo) ───
  console.log('\n\n─── TOP 20 USER THEO coinBalance ───');
  const topCoins = [...users].sort((a, b) => b.coinBalance - a.coinBalance).slice(0, 20);
  for (const u of topCoins) {
    console.log(`  ${u.coinBalance.toString().padStart(10)}  ${u.role.padEnd(10)} ${u.email.padEnd(40)} ${u._count.deposits} dep / ${u._count.purchases} buy`);
  }

  // ─── Top 20 user mới nhất ───
  console.log('\n─── 20 USER MỚI NHẤT ───');
  const newest = [...users].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 20);
  for (const u of newest) {
    console.log(`  ${u.createdAt.toISOString().slice(0, 19)}  ${u.role.padEnd(10)} ${u.email.padEnd(40)} verified=${u.emailVerified}`);
  }
}

main()
  .catch((e) => {
    console.error('❌ Lỗi:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });