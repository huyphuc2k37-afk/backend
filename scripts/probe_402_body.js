const u = 'https://ydmkavspdccylpnskfsg.supabase.co/storage/v1/object/public/covers/cmratrx8p1pzl9w1fjkx7k6fo/31739b2f.webp';
require('https').get(u, r => {
  let d=''; r.on('data',c=>d+=c); r.on('end',()=>console.log('status=',r.statusCode,'\nbody=',d));
});
