const { Client } = require('pg');
const url = process.env.DATABASE_URL || require('dotenv').config().parsed?.DATABASE_URL;
(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    const total = await c.query(`SELECT COUNT(*)::int AS n FROM "Story" WHERE "coverImage" IS NOT NULL`);
    const supa  = await c.query(`SELECT COUNT(*)::int AS n FROM "Story" WHERE "coverImage" ILIKE '%supabase.co%'`);
    const cloud = await c.query(`SELECT COUNT(*)::int AS n FROM "Story" WHERE "coverImage" ILIKE '%cloudinary.com%'`);
    const localish = await c.query(`SELECT COUNT(*)::int AS n FROM "Story" WHERE "coverImage" ILIKE '%/storage/covers/%'`);
    const dataUri = await c.query(`SELECT COUNT(*)::int AS n FROM "Story" WHERE "coverImage" LIKE 'data:image%'`);
    const other = await c.query(`SELECT COUNT(*)::int AS n FROM "Story" WHERE "coverImage" IS NOT NULL AND "coverImage" NOT ILIKE '%supabase.co%' AND "coverImage" NOT ILIKE '%cloudinary.com%' AND "coverImage" NOT ILIKE '%/storage/covers/%' AND "coverImage" NOT LIKE 'data:%'`);
    console.log({
      total_with_cover: total.rows[0].n,
      supabase_cdn:     supa.rows[0].n,
      cloudinary:       cloud.rows[0].n,
      local_storage:    localish.rows[0].n,
      data_uri:         dataUri.rows[0].n,
      other:            other.rows[0].n,
    });

    console.log('\nSupabase covers (all):');
    const list = await c.query(`SELECT id, title, "coverImage" FROM "Story" WHERE "coverImage" ILIKE '%supabase.co%' ORDER BY id`);
    for (const r of list.rows) console.log(`  ${r.id}  ${r.title.slice(0,40)}  ${r.coverImage}`);
  } finally {
    await c.end();
  }
})().catch(e=>{console.error('FATAL',e.message); process.exit(1)});
