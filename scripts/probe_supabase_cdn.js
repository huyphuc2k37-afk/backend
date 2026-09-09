const urls = [
  'https://ydmkavspdccylpnskfsg.supabase.co/storage/v1/object/public/covers/cmratrx8p1pzl9w1fjkx7k6fo/31739b2f.webp',
  'https://ydmkavspdccylpnskfsg.supabase.co/storage/v1/object/public/covers/cmsnevc400152o98yvdc9yz32/e682871e.webp',
  'https://ydmkavspdccylpnskfsg.supabase.co/storage/v1/object/public/covers/cmth9k7p50xh8imfa5yhd9ilp/7a49c110.webp',
  'https://ydmkavspdccylpnskfsg.supabase.co/storage/v1/object/public/covers/cmtjifp07001kqr6pw3z6n2x8/b57f9849.webp',
];
const https = require('https');
(async () => {
  for (const u of urls) {
    await new Promise(resolve => {
      const req = https.get(u, r => {
        let n = 0;
        r.on('data', c => n += c.length);
        r.on('end', () => {
          console.log(`${r.statusCode} bytes=${n} ct=${r.headers['content-type']}  url=${u.slice(-40)}`);
          resolve();
        });
      });
      req.on('error', e => { console.error(`ERR ${e.message}  url=${u.slice(-40)}`); resolve(); });
      req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    });
  }
})();
