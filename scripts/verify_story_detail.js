const https = require('https');
function get(p) {
  return new Promise((res, rej) => {
    const req = https.get('https://backend-production-05227.up.railway.app' + p, r => {
      let d = ''; r.on('data', c=>d+=c); r.on('end', () => res({ s: r.statusCode, j: d }));
    });
    req.on('error', rej);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
  });
}
(async () => {
  const slugs = [
    ['cmratrx8p1pzl9w1fjkx7k6fo', 'mo-mat-ban-gai-ac-doc-cua-thai-tu-gia-da-tai-sinh'],
    ['cmsnevc400152o98yvdc9yz32', 'khai-cuc-thanh-da-than-ta-dua-huong-khoi-chung-dao-chan-than'],
    ['cmth9k7p50xh8imfa5yhd9ilp', 'bi-tuoc-doat-danh-phan-ta-chi-muon-song-sot-lai-tien-tay-thau-tom-ca-noi-cung'],
    ['cmtjifp07001kqr6pw3z6n2x8', 'chuyen-vao-mot-dem'],
  ];
  for (const [id, slug] of slugs) {
    const { s, j } = await get(`/api/stories/${slug}`);
    console.log(`HTTP ${s} ${id}`);
    if (s === 200) {
      const parsed = JSON.parse(j);
      console.log(`   coverImage tail: ${(parsed.coverImage || '-').slice(-50)}`);
      console.log(`   coverUrl       : ${JSON.stringify(parsed.coverUrl)}`);
    } else {
      console.log(`   body: ${j.slice(0, 200)}`);
    }
  }
})();
