/* READ-ONLY: kiểm tra pattern callback_data + khả năng xử lý. */
const { Client } = require('pg');
const url = process.env.DATABASE_URL || require('dotenv').config().parsed?.DATABASE_URL;
(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    // 1. ID Deposit / Withdrawal có định dạng gì?
    const idSamples = await c.query(`
      (SELECT 'deposit' AS kind, id, length(id) AS len FROM "Deposit" ORDER BY "createdAt" DESC LIMIT 3)
      UNION ALL
      (SELECT 'withdraw' AS kind, id, length(id) AS len FROM "Withdrawal" ORDER BY "createdAt" DESC LIMIT 3)
    `);
    console.log('=== ID samples (most recent) ===');
    console.log(JSON.stringify(idSamples.rows, null, 2));

    // 2. Có ID nào chứa ký tự ngoài [a-z0-9] không? (sẽ vẫn hợp lệ với regex nhưng...)
    const charCheck = await c.query(`
      SELECT 'deposit' AS kind, id FROM "Deposit" WHERE id ~ '[^a-z0-9]'
      UNION ALL
      SELECT 'withdraw', id FROM "Withdrawal" WHERE id ~ '[^a-z0-9]'
    `);
    console.log('\n=== IDs with non [a-z0-9] chars (regex will still capture but Prisma may reject) ===');
    console.log(JSON.stringify(charCheck.rows, null, 2));

    // 3. Đếm các giao dịch pending cũ (>1h chưa xử lý) — dấu hiệu click đã fail
    const pending = await c.query(`
      SELECT 'deposit' AS kind, count(*) FILTER (WHERE "createdAt" < now() - interval '1 hour') AS old_pending, count(*) AS total_pending
      FROM "Deposit" WHERE status='pending'
      UNION ALL
      SELECT 'withdraw', count(*) FILTER (WHERE "createdAt" < now() - interval '1 hour'), count(*)
      FROM "Withdrawal" WHERE status='pending'
    `);
    console.log('\n=== Pending breakdown ===');
    console.log(JSON.stringify(pending.rows, null, 2));

    // 4. Có giao dịch approved/rejected ghi adminNote bằng Telegram trong 24h qua?
    const telegramProcessed = await c.query(`
      SELECT 'deposit' AS kind, count(*) FROM "Deposit"
        WHERE "adminNote" IN ('Duyệt qua Telegram', 'Từ chối qua Telegram')
        AND "updatedAt" > now() - interval '24 hours'
      UNION ALL
      SELECT 'withdraw', count(*) FROM "Withdrawal"
        WHERE "adminNote" IN ('Duyệt qua Telegram', 'Từ chối qua Telegram')
        AND "updatedAt" > now() - interval '24 hours'
    `);
    console.log('\n=== Telegram-processed in last 24h ===');
    console.log(JSON.stringify(telegramProcessed.rows, null, 2));

    // 5. Có giao dịch pending nào đã rất lâu (>24h)?
    const stalePending = await c.query(`
      SELECT 'deposit' AS kind, id, "createdAt", "userId" FROM "Deposit"
        WHERE status='pending' AND "createdAt" < now() - interval '24 hours'
      UNION ALL
      SELECT 'withdraw', id, "createdAt", "userId" FROM "Withdrawal"
        WHERE status='pending' AND "createdAt" < now() - interval '24 hours'
      LIMIT 10
    `);
    console.log('\n=== Stale pending > 24h (sample) ===');
    console.log(JSON.stringify(stalePending.rows, null, 2));
  } finally {
    await c.end();
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
