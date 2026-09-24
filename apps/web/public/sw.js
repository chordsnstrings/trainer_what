const CACHE='trainer-workout-shell-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/app')).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('trainer-workout-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(url.pathname.startsWith('/_next/static/')){
  event.respondWith(caches.open(CACHE).then(async cache=>{const saved=await cache.match(request);if(saved)return saved;const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}));return;
 }
 if(request.mode==='navigate'&&(url.pathname==='/app'||url.pathname.startsWith('/app/'))){
  event.respondWith(fetch(request).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put(url.pathname,response.clone());}return response;}).catch(async()=>{const cached=await caches.match(url.pathname,{ignoreVary:true})??await caches.match('/app',{ignoreVary:true});return cached??new Response('Open a workout while online before using it offline.',{status:503,headers:{'Content-Type':'text/plain'}});}));
 }
});
