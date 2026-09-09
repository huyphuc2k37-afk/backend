(async()=>{
  for(let i=0;i<24;i++){
    try{
      const r=await fetch('https://backend-production-05227.up.railway.app/api/health',{signal:AbortSignal.timeout(5000)});
      const j=await r.json();
      const d=new Date(j.timestamp);
      const diff=Math.round((Date.now()-d.getTime())/1000);
      console.log(`[${i}] status=${r.status} deployAge=${diff}s uptime=${j.uptime}s`);
      if(r.status===200 && diff < 600){ console.log('DEPLOY_FRESH'); break; }
    }catch(e){ console.log(`[${i}] err`,e.message); }
    await new Promise(r=>setTimeout(r,5000));
  }
})();
