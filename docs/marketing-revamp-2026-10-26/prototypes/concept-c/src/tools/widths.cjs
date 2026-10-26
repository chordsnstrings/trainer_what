// Overflow + words broken across lines at 768, 1024 and 1600 for every page.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const SITE=process.argv[2]; const widths=(process.argv[3]||'768x1024,1024x768,1600x1000').split(',').map(s=>s.split('x').map(Number));
const server=http.createServer((q,s)=>{let p=decodeURIComponent(new URL(q.url,'http://x').pathname); const f=path.join(SITE,p);if(!fs.existsSync(f)){s.writeHead(404);return s.end();}s.writeHead(200,{'content-type':{'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s);});
(async()=>{await new Promise(r=>server.listen(0,r));const b=await chromium.launch({proxy:{server:'http://127.0.0.1:40713',bypass:'127.0.0.1'}});
const files=fs.readdirSync(SITE).filter(f=>f.endsWith('.html')).sort(); const res=[]; let n=0;
for (const [w,h] of widths) { const ctx=await b.newContext({viewport:{width:w,height:h}}); await ctx.addInitScript(()=>{try{localStorage.setItem('ty-c-consent','denied')}catch(e){}});
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  for (const f of files) { n++; await p.goto(`http://127.0.0.1:${server.address().port}/${f}`,{waitUntil:'load'}); await p.waitForTimeout(200);
    const r=await p.evaluate(async()=>{ document.documentElement.style.scrollBehavior='auto';
      for (let y=0;y<document.documentElement.scrollHeight;y+=Math.round(innerHeight*.5)){scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}
      await new Promise(r=>setTimeout(r,400));
      const vis=(el)=>{ if (el.closest('[hidden],[inert],.sr-only,.skip')) return false; const cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden')return false; const r=el.getBoundingClientRect(); return r.width>0&&r.height>0; };
      const broken=[]; const tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); const range=document.createRange();
      for(let t=tw.nextNode();t;t=tw.nextNode()){ const el=t.parentElement; if(!el||!vis(el)||el.closest('script,style,.vx-out')) continue; const re=/\S{2,}/g; let m; while((m=re.exec(t.textContent))){ if(/[-‐–—\/·]/.test(m[0])) continue; range.setStart(t,m.index); range.setEnd(t,m.index+m[0].length); const tops=new Set([...range.getClientRects()].filter(r=>r.width>.5).map(r=>Math.round(r.top))); if(tops.size>1){broken.push(el.tagName.toLowerCase()+'.'+el.className+' "'+m[0]+'"');break;} } if(broken.length>5)break; }
      return { over: document.documentElement.scrollWidth-innerWidth, pending: document.querySelectorAll('.reveal-pending').length, broken }; });
    if (r.over>0 || r.broken.length || r.pending) res.push(`${f}@${w}: ${JSON.stringify(r)}`); }
  if (errs.length) res.push(`errors@${w}: ${errs.slice(0,3).join(' | ')}`);
  await ctx.close(); }
console.log(`loads=${n}`); console.log(res.length ? res.join('\n') : 'clean'); await b.close(); server.close();})();
