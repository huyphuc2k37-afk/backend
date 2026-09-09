/* READ-ONLY audit script. Không ghi DB production. */
const { Client } = require('pg');

const QUERIES = [
  // 1. Schema tồn tại
  {
    name: 'schema_ChapterPurchase',
    sql: `SELECT to_regclass('public."ChapterPurchase"') AS exists`,
    expect: { exists: 'chapterpurchase' },
  },
  {
    name: 'schema_AuthorEarning',
    sql: `SELECT to_regclass('public."AuthorEarning"') AS exists`,
    expect: { exists: 'authoraearning' },
  },
  {
    name: 'schema_PlatformEarning',
    sql: `SELECT to_regclass('public."PlatformEarning"') AS exists`,
    expect: { exists: 'platformearning' },
  },
  {
    name: 'schema_unique_purchase',
    sql: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename='ChapterPurchase' AND indexname='ChapterPurchase_userId_chapterId_key'`,
    expect: { has_unique: true },
  },

  // 2. Inventory
  {
    name: 'counts',
    sql: `
      SELECT
        (SELECT count(*) FROM "ChapterPurchase")  AS purchases,
        (SELECT count(*) FROM "AuthorEarning" WHERE type='purchase') AS earnings_purchase,
        (SELECT count(*) FROM "PlatformEarning" WHERE type='purchase') AS platform_purchase,
        (SELECT count(*) FROM "Chapter" WHERE "isLocked"=true) AS locked_chapters
    `,
  },

  // 3. Toàn vẹn: tổng author+platform+tax = gross trên tất cả PlatformEarning
  {
    name: 'split_integrity',
    sql: `
      SELECT
        count(*) AS rows,
        sum("authorAmount"+"platformAmount"+"taxAmount" - "grossAmount") AS diff_sum,
        bool_and(("authorAmount"::numeric >= 0 AND "platformAmount"::numeric >= 0 AND "taxAmount"::numeric >= 0)) AS all_non_negative
      FROM "PlatformEarning"
      WHERE type='purchase'
    `,
  },

  // 4. Tỉ lệ thực tế (cho sample lớn)
  {
    name: 'actual_split_ratios',
    sql: `
      SELECT
        round(100.0 * sum("authorAmount") / sum("grossAmount"), 1)  AS author_pct,
        round(100.0 * sum("platformAmount") / sum("grossAmount"), 1) AS platform_pct,
        round(100.0 * sum("taxAmount") / sum("grossAmount"), 1)     AS tax_pct,
        sum("grossAmount") AS gross_total
      FROM "PlatformEarning"
      WHERE type='purchase'
    `,
  },

  // 5. Top 3 user mua nhiều
  {
    name: 'top_purchasers',
    sql: `
      SELECT u.id, u.email, u."coinBalance", count(p.id) AS cnt, sum(p.coins) AS total_spent
      FROM "ChapterPurchase" p
      JOIN "User" u ON u.id = p."userId"
      GROUP BY u.id, u.email, u."coinBalance"
      ORDER BY total_spent DESC NULLS LAST
      LIMIT 5
    `,
  },

  // 6. Tác giả nhận: kiểm tra AuthorEarning.amount == PlatformEarning.authorAmount cùng (chapterId, authorId)
  {
    name: 'author_earning_matches',
    sql: `
      WITH matched AS (
        SELECT
          cp."chapterId",
          ae."authorId",
          ae.amount AS ae_amt,
          pe."authorAmount" AS pe_amt,
          (ae.amount = pe."authorAmount") AS ok
        FROM "ChapterPurchase" cp
        JOIN "AuthorEarning" ae ON ae."chapterId" = cp."chapterId" AND ae.type = 'purchase'
        JOIN "PlatformEarning" pe ON pe."chapterId" = cp."chapterId" AND pe.type='purchase'
      )
      SELECT
        count(*) AS total,
        sum(case when ok then 1 else 0 end) AS matched_rows
      FROM matched
    `,
  },

  // 7. Một record mẫu gần nhất để xem shape
  {
    name: 'sample_recent_purchase',
    sql: `
      SELECT
        cp.id, cp."userId", cp."chapterId", cp.coins, cp."createdAt",
        ae.amount  AS author_share,
        pe."grossAmount", pe."authorAmount", pe."platformAmount", pe."taxAmount"
      FROM "ChapterPurchase" cp
      LEFT JOIN "AuthorEarning" ae
        ON ae."chapterId" = cp."chapterId" AND ae."fromUserId" = cp."userId" AND ae.type='purchase'
      LEFT JOIN "PlatformEarning" pe
        ON pe."chapterId" = cp."chapterId" AND pe."fromUserId" = cp."userId" AND pe.type='purchase'
      ORDER BY cp."createdAt" DESC
      LIMIT 3
    `,
  },
];

(async () => {
  const url = process.env.DATABASE_URL || require('dotenv').config().parsed?.DATABASE_URL;
  if (!url) throw new Error('No DATABASE_URL');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    for (const q of QUERIES) {
      console.log(`\n=== ${q.name} ===`);
      const r = await c.query(q.sql);
      console.log(JSON.stringify(r.rows, null, 2));
    }
  } finally {
    await c.end();
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
