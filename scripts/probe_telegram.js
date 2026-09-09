import 'dotenv/config';
import https from 'node:https';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const api = (method, body) => new Promise((resolve, reject) => {
  const payload = JSON.stringify(body || {});
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const req = https.request({ hostname: new URL(url).hostname, path: new URL(url).pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
  });
  req.on('error', reject);
  req.write(payload); req.end();
});

(async () => {
  if (!BOT_TOKEN || !CHAT_ID) { console.error('Missing env'); process.exit(1); }

  console.log('=== Telegram Bot Full Check ===\n');

  // 1. Bot info
  const me = await api('getMe');
  console.log('1. Bot: ' + (me.ok ? `✅ @${me.result.username}` : `❌ ${me.description}`));

  // 2. Chat info
  const chat = await api('getChat', { chat_id: CHAT_ID });
  console.log('2. Chat: ' + (chat.ok ? `✅ ${chat.result.type} "${chat.result.username || chat.result.title || chat.result.first_name}"` : `❌ ${chat.description}`));

  // 3. Bot's member status in chat
  const member = await api('getChatMember', { chat_id: CHAT_ID, user_id: me.result.id });
  console.log('3. Bot role: ' + (member.ok ? `✅ ${member.result.status}` : `❌ ${member.description}`));

  // 4. Pending updates
  const updates = await api('getUpdates', { timeout: 1, allowed_updates: ['callback_query', 'message'] });
  console.log(`4. Pending updates: ${updates.result?.length || 0}`);
  if (updates.result?.length) {
    updates.result.slice(0, 5).forEach(u => {
      if (u.callback_query) console.log('   callback_query:', u.callback_query.data, 'from', u.callback_query.from.username);
      if (u.message) console.log('   message:', (u.message.text || '').slice(0, 50));
    });
  }

  // 5. Last N messages in chat
  console.log(`\n5. Recent messages in chat ${CHAT_ID}:`);
  // Use getUpdates with offset to see recent messages
  // Or try forward messages from a known message
  const msgTest = await api('sendMessage', { chat_id: CHAT_ID, text: '🔍 Diagnostic check — ' + new Date().toISOString(), reply_markup: { inline_keyboard: [[{ text: '🟢 Alive', callback_data: 'diag_alive' }, { text: '📊 Status', callback_data: 'diag_status' }]] } });
  if (msgTest.ok) {
    console.log(`   ✅ Test msg sent: id=${msgTest.result.message_id}`);
    // Wait a moment then get it
    const fetched = await api('getMessage', { chat_id: CHAT_ID, message_id: msgTest.result.message_id });
    console.log(`   Fetch test: ${fetched.ok ? '✅ fetched OK, has_reply_markup=' + !!fetched.result.reply_markup : '❌ ' + fetched.description}`);
    if (fetched.ok && fetched.result.reply_markup) {
      const btns = fetched.result.reply_markup.inline_keyboard.flat().map(b => b.text + '[' + b.callback_data + ']').join(' | ');
      console.log(`   Buttons: ${btns}`);
    }
  } else {
    console.log(`   ❌ sendMessage failed: ${msgTest.description}`);
  }

  // 6. Simulate clicking one of our diagnostic buttons
  console.log('\n6. Checking for any pending callbacks (getUpdates)...');
  const upd2 = await api('getUpdates', { timeout: 0, allowed_updates: ['callback_query'] });
  if (upd2.ok) {
    console.log(`   Pending: ${upd2.result.length}`);
    upd2.result.forEach(u => {
      const cq = u.callback_query;
      console.log(`   Found: data="${cq.data}" from @${cq.from.username} msg=${cq.message?.message_id} chat=${cq.message?.chat?.id}`);
    });
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
