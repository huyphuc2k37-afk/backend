/* Wait for Vercel to redeploy frontend by polling the home page. */
(async () => {
  const url = 'https://vstory.vn/';
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
      const html = await r.text();
      // After rebuild, the html will reference new build id (or chunk hashes).
      const m = html.match(/static\/chunks\/_app-([a-z0-9]+)\.js/) || html.match(/\"buildId\":\"([^\"]+)\"/);
      console.log(`[${i}] ${r.status} buildId=${m?.[1]?.slice(0,12) || '-'}`);
      if (r.status === 200) {
        // Just break after a couple successful polls to confirm stable
        await new Promise(r=>setTimeout(r,3000));
        break;
      }
    } catch (e) { console.log(`[${i}] err`, e.message); }
    await new Promise(r=>setTimeout(r,5000));
  }
})();
