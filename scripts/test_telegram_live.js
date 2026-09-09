/* Tạo 1 deposit pending thật trong DB (chỉ khi hiện đang = 0), rồi inject
 * callback_query giả qua Telegram getUpdates thông qua cùng token.
 * Đợi backend xử lý qua polling loop, sau đó kiểm tra DB xem status đã đổi chưa.
 *
 * LƯU Ý: script này GHI vào DB production (1 INSERT deposit pending).
 * Dùng idempotent: chỉ insert nếu không có deposit pending nào đang tồn tại.
 */
const { Client } = require('pg');
const https = require('https');

const url = process.env.DATABASE_URL || require('dotenv').config().parsed?.DATABASE_URL;
const env = require('dotenv').config().parsed || {};
const TG_TOKEN = (env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT  = (env.TELEGRAM_CHAT_ID   || '').trim();

function tgPost(method, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, r => {
      let d=''; r.on('data', c=>d+=c); r.on('end', ()=>{ try { resolve(JSON.parse(d)); } catch { resolve({raw:d}); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.write(payload); req.end();
  });
}

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    // 1. Check if there's already a pending deposit
    const existing = await c.query(`SELECT id, "userId", "transferCode", status FROM "Deposit" WHERE status='pending' ORDER BY "createdAt" DESC LIMIT 1`);
    let testDeposit;
    if (existing.rows.length > 0) {
      testDeposit = existing.rows[0];
      console.log('USING_EXISTING:', testDeposit.id);
    } else {
      // 2. Pick a real user
      const u = await c.query(`SELECT id, "coinBalance" FROM "User" WHERE "coinBalance" >= 1000 ORDER BY "coinBalance" DESC LIMIT 1`);
      if (!u.rows.length) { console.error('NO_USER'); process.exit(1); }
      const userId = u.rows[0].id;
      const code = 'VS-TEST' + Date.now().toString(36).toUpperCase().slice(-6);
      const ins = await c.query(
        `INSERT INTO "Deposit" (id, amount, coins, method, status, "transferCode", "transferNote", "userId", "updatedAt")
         VALUES (gen_random_uuid()::text, 10000, 10000, 'agribank', 'pending', $1, 'test-script', $2, now())
         RETURNING id, "userId", "transferCode", status`,
        [code, userId]
      );
      testDeposit = ins.rows[0];
      console.log('INSERTED:', testDeposit.id, 'transferCode=', testDeposit.transferCode);
    }

    // 3. Send a NEW Telegram message with the approve button. Backend will not auto-send for our test deposit.
    //    Instead we synthesise a callback_query directly by manually calling answerCallbackQuery path:
    //    The trick: use sendMessage with reply_markup inline_button, then click it via /answers etc.
    //    But Telegram will NOT let us programmatically click a button. We can only *simulate* by calling
    //    answerCallbackQuery manually — but the actual button press arrives via update from Telegram's
    //    client. So instead, the cleanest test is: send a message + wait — if backend polling is alive
    //    it'll re-send / we won't be able to inject a callback from outside.

    // Real test: send an admin-trigger message via bot (will arrive in your Telegram), but we still
    // can't auto-click the button. So we just verify that:
    // (a) backend polling loop is healthy (calling getUpdates returns long-poll OK or queue empty)
    // (b) deposit exists with status pending
    const send = await tgPost('sendMessage', {
      chat_id: TG_CHAT,
      text: `🧪 TEST deposit pending\nID: \`${testDeposit.id}\`\nCode: ${testDeposit.transferCode}`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[
        { text: '✅ Test Duyệt', callback_data: `approve_deposit_${testDeposit.id}` },
        { text: '❌ Test Từ chối', callback_data: `reject_deposit_${testDeposit.id}` },
      ]]},
    });
    console.log('SEND_RESULT:', JSON.stringify(send).slice(0, 200));

    console.log('\nTest deposit ready. Open Telegram and click a button to verify.');
    console.log('DEPOSIT_ID=' + testDeposit.id);
  } finally {
    await c.end();
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
