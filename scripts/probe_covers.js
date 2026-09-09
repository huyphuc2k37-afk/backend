const ids = [
  'cmratrx8p1pzl9w1fjkx7k6fo',
  'cmth9k7p50xh8imfa5yhd9ilp',
  'cmsnevc400152o98yvdc9yz32',
  'cmtjifp07001kqr6pw3z6n2x8',
];
const https = require('https');

(async () => {
  for (const id of ids) {
    await new Promise(resolve => {
      const req = https.get(`https://backend-production-05227.up.railway.app/api/stories/${id}/cover`, r => {
        let n = 0;
        r.on('data', c => n += c.length);
        r.on('end', () => {
          console.log(`${id.slice(0,8)}: HTTP ${r.statusCode}  bytes=${n}  ct=${r.headers['content-type']||'-'}  cc=${r.headers['cache-control']||'-'}`);
          resolve();
        });
      });
      req.on('error', e => { console.error(`${id.slice(0,8)}: ERR ${e.message}`); resolve(); });
      req.setTimeout(8000, () => { req.destroy(new Error('timeout')); });
    });
  }
})();
