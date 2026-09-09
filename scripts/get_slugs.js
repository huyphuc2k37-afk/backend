const { Client } = require('pg');
const url = process.env.DATABASE_URL || require('dotenv').config().parsed?.DATABASE_URL;
const ids = ['cmratrx8p1pzl9w1fjkx7k6fo','cmth9k7p50xh8imfa5yhd9ilp','cmsnevc400152o98yvdc9yz32','cmtjifp07001kqr6pw3z6n2x8'];
(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r = await c.query(`SELECT id, slug FROM "Story" WHERE id = ANY($1::text[])`, [ids]);
    for (const row of r.rows) console.log(row.id, '=>', row.slug);
  } finally { await c.end(); }
})();
