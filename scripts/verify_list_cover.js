/* Scan all stories page by page, find any Supabase rows and verify their coverUrl is null. */
(async () => {
  const base = 'https://backend-production-05227.up.railway.app/api/stories';
  let page = 1, totalSupa = 0, sample = [];
  while (page <= 10) {
    const r = await fetch(`${base}?limit=50&page=${page}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const items = j.items || j.stories || [];
    const supa = items.filter(s => (s.coverImage || '').includes('supabase.co'));
    totalSupa += supa.length;
    if (sample.length < 6) for (const s of supa) sample.push(s);
    console.log(`page ${page}: items=${items.length} supa=${supa.length}`);
    if (items.length < 50) break;
    page++;
  }
  console.log('totalSupa in scan:', totalSupa);
  console.log('sample check:');
  for (const s of sample) {
    const ok = s.coverUrl === null;
    console.log(`  ${ok ? 'OK' : 'BAD'}  ${s.id} coverUrl=${JSON.stringify(s.coverUrl)}`);
  }
})();
