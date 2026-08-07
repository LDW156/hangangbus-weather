const CACHE = 'hangangbus-ui-v91-7';
const STATIC_ASSETS = [
  './dashboard.css?v=91.7','./history.css?v=91.7','./styles.css?v=91.7',
  './module-pages.css?v=91.7','./shared-sidebar.css?v=91.7',
  './dashboard.js?v=91.7','./history.js?v=91.7','./app.js?v=91.7',
  './module-pages.js?v=91.7','./shared-navigation.js?v=91.7','./app-bootstrap.js?v=91.7',
  './shared-config.js?v=91.7','./weather-config.js?v=91.7','./ocean-config.js?v=91.7',
  './config.js?v=91.7','./hrfco.js?v=91.7','./kma.js?v=91.7','./ocean.js?v=91.7',
  './history-config.js?v=91.7','./assets/hangangbus-logo.png?v=88'
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
