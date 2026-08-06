const CACHE='hangangbus-data-analysis-v91-1';
const ASSETS=[
  './',
  './index.html',
  './detail.html',
  './dashboard.css?v=90',
  './dashboard.js?v=91.0',
  './styles.css?v=88',
  './app.js?v=90.2',
  './shared-config.js?v=62',
  './weather-config.js?v=62',
  './ocean-config.js?v=67',
  './config.js?v=62',
  './data/demo-data.js?v=62',
  './hrfco.js?v=62',
  './kma.js?v=87',
  './ocean.js?v=69',
  './assets/hangangbus-logo.png?v=88',
  './history.css?v=91.1',
  './history-config.js?v=90.1',
  './history.js?v=91.1'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;

  event.respondWith(
    fetch(event.request)
      .then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});
