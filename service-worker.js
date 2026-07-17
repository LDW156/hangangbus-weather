const CACHE='hangangbus-critical-alerts-only-v81';
const ASSETS=[
  './',
  './index.html',
  './styles.css?v=81',
  './shared-config.js?v=61',
  './weather-config.js?v=62',
  './ocean-config.js?v=67',
  './config.js?v=62',
  './hrfco.js?v=62',
  './kma.js?v=81',
  './ocean.js?v=69',
  './app.js?v=81',
  './data/demo-data.js?v=62',
  './manifest.webmanifest',
  './assets/hangangbus-logo.png?v=62',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // HRFCO 등 외부 실시간 API는 캐시하지 않습니다.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // HTML/JS/CSS는 항상 네트워크를 먼저 확인합니다.
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        if (event.request.method === 'GET' && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
