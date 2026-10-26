// Screens of interactive states: menu open, dev panel, registration closed, payments on.
// Usage: node src/tools/states.cjs site shots  (menu, sticky, dev panel, flags, calculators, dropdown, tablet heroes)
const http=require("http"),fs=require("fs"),path=require("path");const {chromium}=require("playwright");
const SITE=process.argv[2], OUT=process.argv[3];
const s=http.createServer((q,r)=>{const f=path.join(SITE,new URL(q.url,"http://x").pathname);if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end()}r.writeHead(200,{"content-type":{".html":"text/html",".css":"text/css",".js":"text/javascript",".svg":"image/svg+xml"}[path.extname(f)]||"x"});fs.createReadStream(f).pipe(r)});
(async()=>{await new Promise(r=>s.listen(0,r));const b=await chromium.launch();const base=`http://127.0.0.1:${s.address().port}/`;
const logs=[];
const mk=async(w,h)=>{const p=await b.newPage({viewport:{width:w,height:h}});p.on("console",m=>logs.push(m.type()+": "+m.text().slice(0,160)));p.on("pageerror",e=>logs.push("ERR "+e.message));await p.addInitScript(()=>{try{localStorage.setItem("ty-c-consent","granted")}catch(e){}});return p;};
let p=await mk(390,844);await p.goto(base+"index.html");await p.waitForTimeout(1600);
await p.screenshot({path:OUT+"/st-hero-390.png"});
await p.click("[data-menu-btn]");await p.waitForTimeout(500);await p.screenshot({path:OUT+"/st-menu-390.png"});
await p.keyboard.press("Escape");await p.waitForTimeout(400);
await p.evaluate(()=>scrollTo(0,1400));await p.waitForTimeout(700);await p.screenshot({path:OUT+"/st-sticky-390.png"});
await p.click("[data-dev-toggle]");await p.waitForTimeout(300);await p.screenshot({path:OUT+"/st-dev-390.png"});
// flip registration + payments
await p.click('[data-flag="registration"]');await p.click('[data-flag="payments"]');await p.waitForTimeout(200);
const st=await p.evaluate(()=>({reg:document.documentElement.dataset.registration,pay:document.documentElement.dataset.payments,cta:document.querySelector('.hero a[data-cta]').getAttribute("href"),label:document.querySelector('.hero a[data-cta]').innerText}));
console.log(JSON.stringify(st));
// interact with follower calc
await p.click('[data-dev-close]');
await p.fill("#fc-followers","20000");await p.waitForTimeout(900);
console.log(await p.$eval('[data-vx="headline"]',e=>e.innerText), await p.$eval("#fc-live",e=>e.textContent));
// stepper next
await p.click('[data-step="1"]');await p.waitForTimeout(400);
console.log("step", await p.$eval('[data-vx="step"]',e=>e.innerText));
// faq open
await p.click(".faq-q");await p.waitForTimeout(400);
await p.close();
p=await mk(1366,900);await p.goto(base+"pricing.html");await p.waitForTimeout(600);
await p.click(".nav-menu-btn");await p.waitForTimeout(300);await p.screenshot({path:OUT+"/st-dropdown-1366.png"});
await p.keyboard.press("Escape");
await p.$eval("#bm-range",e=>{e.value=900;e.dispatchEvent(new Event("input",{bubbles:true}))});await p.waitForTimeout(400);
console.log(await p.$eval('[data-vx="count"]',e=>e.innerText), await p.$eval('[data-vx="rate"]',e=>e.innerText));
await p.close();
for (const w of [768,1024]){p=await mk(w,w==768?1024:768);await p.goto(base+"index.html");await p.waitForTimeout(1600);await p.screenshot({path:OUT+`/st-home-${w}.png`});await p.close();}
console.log(logs.filter(l=>!/^log: %ctyTrack/.test(l)).join("\n")||"no console errors");
console.log(logs.filter(l=>/tyTrack/.test(l)).map(l=>l.replace(/%c|background[^"]*?padding:1px 4px;border-radius:2px/g,"")).slice(0,12).join("\n"));
await b.close();s.close()})();
