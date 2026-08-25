(() => {
  'use strict';
  const BUILD = 'secure-auth-v1';
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

    // 보안 포털에서는 Service Worker 오프라인 캐시를 사용하지 않습니다.
    // 인증 종료 후 보호 자산이 브라우저 캐시에 남아 제공되는 것을 방지합니다.
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(registration => registration.unregister()));
      } catch (_) {}
    }
  }

  window.addEventListener('load', migrate, { once: true });
})();
