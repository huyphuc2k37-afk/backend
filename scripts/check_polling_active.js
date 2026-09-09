/* Check if Telegram polling on backend has hot-reloaded to pick up fix commit.
 * We do this by sending a 2nd message and asking backend to handle a unique synthetic callback.
 * Since we can't synthesise a real callback_query from outside Telegram, instead check
 * getUpdates as a 3rd party — if our Railway bot's long-poll already consumed it, the
 * update will not be in the queue when we ask.
 */
const https = require('https');
const env = require('dotenv').config().parsed || {};
const TOKEN = (env.TELEGRAM_BOT_TOKEN || '').trim();

(async () => {
  // Wait for our test message to be processed by polling loop
  await new Promise(r => setTimeout(r, 3000));

  const r = await new Promise(resolve => {
    const req = https.get(
      `https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=0&allowed_updates=${encodeURIComponent('["callback_query"]')}`,
      resp => { let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>resolve(JSON.parse(d))); }
    );
    req.on('error', e => resolve({error: e.message}));
  });
  console.log('result count:', (r.result || []).length, 'description:', r.description || '-');
  if (r.result && r.result.length) {
    for (const u of r.result.slice(-3)) {
      console.log('  update_id:', u.update_id, 'has callback:', !!u.callback_query);
    }
  }
})();
