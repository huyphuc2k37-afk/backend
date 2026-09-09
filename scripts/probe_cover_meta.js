const { Client } = require('pg');
const url = process.env.DATABASE_URL || require('dotenv').config().parsed?.DATABASE_URL;
const ids = [
  'cmratrx8p1pzl9w1fjkx7k6fo',
  'cmth9k7p50xh8imfa5yhd9ilp',
  'cmsnevc400152o98yvdc9yz32',
  'cmtjifp07001kqr6pw3z6n2x8',
];
(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT id, title, "approvalStatus", "coverApprovalStatus",
              CASE WHEN "coverImage" IS NULL THEN 'NULL'
                   WHEN length("coverImage") < 200 THEN "coverImage"
                   ELSE 'prefix:' || left("coverImage", 120) || '... [len=' || length("coverImage") || ']'
              END AS coverImage
       FROM "Story" WHERE id = ANY($1::text[])`,
      [ids]
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } finally {
    await c.end();
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
