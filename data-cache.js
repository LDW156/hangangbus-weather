(() => {
  'use strict';

  const BUILD = '91.8';
  const TTL_MS = 10 * 60 * 1000;
  const KEY = `hangangbus:live-snapshot:${BUILD}`;
  const LOCK_KEY = `hangangbus:live-refresh-lock:${BUILD}`;
  const CHANNEL_NAME = `hangangbus-live-data-${BUILD}`;
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
        data: parsed.data
      };
    } catch (_) {
      return null;
    }
  }

  function readAny() {
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

  function acquireLock(force = false) {
    if (force) {
      try {
        localStorage.setItem(LOCK_KEY, JSON.stringify({ owner, expiresAt:Date.now()+120000 }));
      } catch (_) {}
      return true;
    }

    try {
      const current = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
      if (current?.expiresAt > Date.now() && current.owner !== owner) return false;
      localStorage.setItem(LOCK_KEY, JSON.stringify({ owner, expiresAt:Date.now()+120000 }));
      const verify = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
      return verify?.owner === owner;
    } catch (_) {
      return true;
    }
  }

  function releaseLock() {
    try {
      const current = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
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

  window.HANGANG_DATA_CACHE = {
    BUILD,
    TTL_MS,
    readAny,
    readFresh,
    write,
    acquireLock,
    releaseLock,
    subscribe
  };
})();
