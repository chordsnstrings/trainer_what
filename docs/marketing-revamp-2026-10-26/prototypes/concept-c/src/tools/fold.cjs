// Hero primary CTA inside the first viewport (consent dismissed) at phone sizes and desktop.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const SITE=process.argv[2];
const server=http.createServer((q,s)=>{let p=decodeURIComponent(new URL(q.url,'http://x').pathname); const f=path.join(SITE,p);if(!fs.existsSync(f)){s.writeHead(404);return s.end();}s.writeHead(200,{'content-type':{'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s);});
(async()=>{await new Promise(r=>server.listen(0,r));const b=await chromium.launch({proxy:{server:'http://127.0.0.1:40713',bypass:'127.0.0.1'}});
const files=fs.readdirSync(SITE).filter(f=>f.endsWith('.html')).sort(); const res=[];
for (const [w,h] of [[360,780],[390,844],[1366,900]]) { const ctx=await b.newContext({viewport:{width:w,height:h}}); await ctx.addInitScript(()=>{try{localStorage.setItem('ty-c-consent','denied')}catch(e){}});
  const p=await ctx.newPage();
  for (const f of files) { await p.goto(`http://127.0.0.1:${server.address().port}/${f}`,{waitUntil:'load'}); await p.waitForTimeout(250);
    const r=await p.evaluate(()=>{ const c=document.querySelector('[data-hero] a[data-cta="primary"], [data-hero] button[type=submit], [data-hero] form button'); if(!c) return {none:true}; const b=c.getBoundingClientRect(); const h1=document.querySelector('h1').getBoundingClientRect(); return {ctaBottom:Math.round(b.bottom), h1Bottom:Math.round(h1.bottom), ih:innerHeight}; });
    if (r.none || r.ctaBottom > r.ih) res.push(`${f}@${w}: ${JSON.stringify(r)}`); }
  await ctx.close(); }
console.log(res.length ? res.join('\n') : 'all hero CTAs in first viewport'); await b.close(); server.close();})();
