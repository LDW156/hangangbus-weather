const CACHE='hangangbus-hybrid-v1';
const ASSETS=['./','./index.html','./styles.css?v=20','./config.js','./hrfco.js','./app.js','./data/demo-data.js','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin){e.respondWith(fetch(e.request,{cache:'no-store'}));return;}
  e.respondWith(fetch(e.request).then(r=>{if(e.request.method==='GET'){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request)));
});
