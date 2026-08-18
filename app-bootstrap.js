(() => {
  'use strict';
  const BUILD = '92.1';
  const KEY = 'hangangbus:ui-build';

  async function migrate() {
    const previous = localStorage.getItem(KEY);
    if (previous !== BUILD) {
      sessionStorage.removeItem('hangangbus-view');
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      }
      localStorage.setItem(KEY, BUILD);
    }

    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register(
          './service-worker.js',
          { updateViaCache: 'none' }
        );
        await registration.update();
      } catch (_) {}
    }
  }

  window.addEventListener('load', migrate, { once: true });
})();
