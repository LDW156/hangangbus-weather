const CACHE = 'hangangbus-portal-v93-0';
const STATIC_ASSETS = [
  './home.css?v=93.0','./home.js?v=93.0','./auth-config.js?v=93.0','./auth-client.js?v=93.0',
  './user-management.css?v=93.0','./user-management.js?v=93.0',
  './dashboard.css?v=92.5','./history.css?v=92.1','./styles.css?v=92.1',
  './module-pages.css?v=92.1','./shared-sidebar.css?v=92.1',
  './dashboard.js?v=92.5','./history.js?v=92.3','./app.js?v=92.1',
  './module-pages.js?v=92.1','./shared-navigation.js?v=92.1','./app-bootstrap.js?v=92.1',
  './shared-config.js?v=92.1','./weather-config.js?v=92.1','./ocean-config.js?v=92.1',
  './config.js?v=92.1','./data-cache.js?v=92.1','./hrfco.js?v=92.1','./kma.js?v=92.1','./ocean.js?v=92.1',
  './history-config.js?v=92.1','./assets/hangangbus-logo.png?v=88'
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
