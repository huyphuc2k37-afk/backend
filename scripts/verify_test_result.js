/* Verify test deposit status after admin clicks Telegram button */
const { Client } = require('pg');
const url = process.env.DATABASE_URL || require('dotenv').config().parsed?.DATABASE_URL;
const args = process.argv.slice(2);
const id = args[0] || 'cmtu0wswf00094qj421x3nozp';
(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    const dep = await c.query(`SELECT id, status, "adminNote", "updatedAt" FROM "Deposit" WHERE id=$1`, [id]);
    console.log('Deposit:', JSON.stringify(dep.rows[0]));
    const noti = await c.query(`SELECT type, title, message, "createdAt" FROM "Notification" WHERE link='/wallet' AND "createdAt" > now() - interval '10 minutes' ORDER BY "createdAt" DESC LIMIT 5`);
    console.log('Recent wallet notifications:', JSON.stringify(noti.rows, null, 2));
  } finally {
    await c.end();
  }
})().catch(e=>{console.error('FATAL',e.message); process.exit(1)});
