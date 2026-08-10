const CACHE = 'hangangbus-ui-v91-9';
const STATIC_ASSETS = [
  './dashboard.css?v=91.9','./history.css?v=91.9','./styles.css?v=91.9',
  './module-pages.css?v=91.9','./shared-sidebar.css?v=91.9',
  './dashboard.js?v=91.9','./history.js?v=91.9','./app.js?v=91.9',
  './module-pages.js?v=91.9','./shared-navigation.js?v=91.9','./app-bootstrap.js?v=91.9',
  './shared-config.js?v=91.9','./weather-config.js?v=91.9','./ocean-config.js?v=91.9',
  './config.js?v=91.9','./data-cache.js?v=91.9','./hrfco.js?v=91.9','./kma.js?v=91.9','./ocean.js?v=91.9',
  './history-config.js?v=91.9','./assets/hangangbus-logo.png?v=88'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => new Response('네트워크 연결을 확인하십시오.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
    return;
  }
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request, { cache: 'no-cache' }).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request)));
});
