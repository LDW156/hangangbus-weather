(() => {
  'use strict';

  const BUILD = '92.1';
  const TTL_MS = 10 * 60 * 1000;
  // UI 버전과 무관한 안정 키: 화면 업데이트 때 실데이터 캐시를 버리지 않습니다.
  const KEY = 'hangangbus:live-snapshot:stable-v1';
  const LOCK_KEY = 'hangangbus:live-refresh-lock:stable-v1';
  const LEGACY_PREFIX = 'hangangbus:live-snapshot:';
  const CHANNEL_NAME = 'hangangbus-live-data-stable-v1';
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = 'BroadcastChannel' in window
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function parse(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.savedAt || !parsed.data) return null;
      const savedAt = new Date(parsed.savedAt);
      if (Number.isNaN(savedAt.getTime())) return null;
      return {
        savedAt,
        ageMs: Math.max(0, Date.now() - savedAt.getTime()),
        data: parsed.data,
        meta: parsed.meta || {}
      };
    } catch (_) {
      return null;
    }
  }

  function newestLegacySnapshot() {
    let newest = null;
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(LEGACY_PREFIX) || key === KEY) continue;
        const candidate = parse(localStorage.getItem(key));
        if (!candidate) continue;
        if (!newest || candidate.savedAt > newest.savedAt) newest = candidate;
      }
    } catch (_) {}
    return newest;
  }

  function migrateLegacyIfNeeded() {
    try {
      if (parse(localStorage.getItem(KEY))) return;
      const legacy = newestLegacySnapshot();
      if (!legacy) return;
      localStorage.setItem(KEY, JSON.stringify({
        build: BUILD,
        savedAt: legacy.savedAt.toISOString(),
        meta: { ...(legacy.meta || {}), migratedFromLegacy: true },
        data: legacy.data
      }));
    } catch (_) {}
  }

  function readAny() {
    migrateLegacyIfNeeded();
    try {
      const parsed = parse(localStorage.getItem(KEY));
      return parsed ? { ...parsed, data: clone(parsed.data) } : null;
    } catch (_) {
      return null;
    }
  }

  function readFresh() {
    const cached = readAny();
    return cached && cached.ageMs < TTL_MS ? cached : null;
  }

  function write(data, meta = {}) {
    const payload = {
      build: BUILD,
      savedAt: new Date().toISOString(),
      meta,
      data: clone(data)
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(payload));
      channel?.postMessage({ type:'updated', savedAt:payload.savedAt });
    } catch (_) {}
    return payload;
  }

  function readLock() {
    try {
      return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  function acquireLock(force = false) {
    const now = Date.now();
    // 90초 임대. 정상 페이지 이동 시 pagehide에서 즉시 해제합니다.
    const next = { owner, createdAt: now, expiresAt: now + 90000 };

    if (force) {
      try { localStorage.setItem(LOCK_KEY, JSON.stringify(next)); } catch (_) {}
      return true;
    }

    try {
      const current = readLock();
      if (current?.expiresAt > now && current.owner !== owner) return false;
      localStorage.setItem(LOCK_KEY, JSON.stringify(next));
      return readLock()?.owner === owner;
    } catch (_) {
      return true;
    }
  }

  function releaseLock() {
    try {
      const current = readLock();
      if (!current || current.owner === owner) localStorage.removeItem(LOCK_KEY);
    } catch (_) {}
  }

  function subscribe(handler) {
    if (typeof handler !== 'function') return () => {};
    const onStorage = event => {
      if (event.key === KEY && event.newValue) handler(readAny());
    };
    window.addEventListener('storage', onStorage);
    const onMessage = () => handler(readAny());
    channel?.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('storage', onStorage);
      channel?.removeEventListener('message', onMessage);
    };
  }

  function waitForSnapshot(timeoutMs = 2500) {
    return new Promise(resolve => {
      const immediate = readAny();
      if (immediate) {
        resolve(immediate);
        return;
      }

      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        clearInterval(timer);
        clearTimeout(timeout);
        unsubscribe();
        resolve(value || null);
      };
      const unsubscribe = subscribe(snapshot => {
        if (snapshot) finish(snapshot);
      });
      const timer = setInterval(() => {
        const snapshot = readAny();
        if (snapshot) finish(snapshot);
      }, 250);
      const timeout = setTimeout(() => finish(null), timeoutMs);
    });
  }

  // 다른 페이지로 이동하면서 API 호출이 중단되면 잠금이 남지 않도록 정리합니다.
  window.addEventListener('pagehide', releaseLock);
  window.addEventListener('beforeunload', releaseLock);
  migrateLegacyIfNeeded();

  window.HANGANG_DATA_CACHE = {
    BUILD,
    TTL_MS,
    KEY,
    readAny,
    readFresh,
    write,
    acquireLock,
    releaseLock,
    subscribe,
    waitForSnapshot
  };
})();
