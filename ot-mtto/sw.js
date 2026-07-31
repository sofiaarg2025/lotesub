const CACHE='ot-mtto-v2.0.0';
const CORE=['./','./index.html','./styles.css','./app-core.js','./app-dashboard.js','./app-orders.js','./app-modules.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(res=>{
    const copy=res.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return res;
  }).catch(()=>caches.match('./index.html'))));
});
