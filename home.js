(() => {
  'use strict';

  const STORAGE_KEY = 'hangangbus_portal_preview_auth';
  const body = document.body;
  const clock = document.getElementById('portalClock');
  const form = document.getElementById('portalLoginForm');
  const idInput = document.getElementById('portalLoginId');
  const pwInput = document.getElementById('portalLoginPw');
  const sessionBox = document.getElementById('portalSession');
  const sessionId = document.getElementById('portalSessionId');
  const logoutButton = document.getElementById('portalLogoutButton');
  const protectedElements = [...document.querySelectorAll('[data-protected="true"]')];

  const tick = () => {
    const now = new Date();
    clock.textContent = new Intl.DateTimeFormat('ko-KR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(now);
  };

  const getSession = () => {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  };

  const setLockedState = session => {
    const unlocked = !!(session && session.userId);
    body.classList.toggle('auth-unlocked', unlocked);
    body.classList.toggle('auth-locked', !unlocked);

    if (unlocked) {
      form.hidden = true;
      sessionBox.hidden = false;
      sessionId.textContent = session.userId;
    } else {
      form.hidden = false;
      sessionBox.hidden = true;
      sessionId.textContent = '-';
    }

    protectedElements.forEach(element => {
      if (element.tagName === 'A') {
        element.setAttribute('aria-disabled', String(!unlocked));
        element.tabIndex = unlocked ? 0 : -1;
      }
    });
  };

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-protected="true"]');
    if (!target || body.classList.contains('auth-unlocked')) return;
    event.preventDefault();
    event.stopPropagation();
    idInput.focus();
  }, true);

  form.addEventListener('submit', event => {
    event.preventDefault();
    const userId = idInput.value.trim();
    const password = pwInput.value;

    if (!userId || !password) {
      if (!userId) idInput.focus();
      else pwInput.focus();
      return;
    }

    // 현재는 메인홈 UI 시안용 잠금입니다.
    // 다음 단계에서 이 부분을 Cloudflare Worker + D1 인증 API 호출로 교체합니다.
    const session = { userId, signedInAt: new Date().toISOString() };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    pwInput.value = '';
    setLockedState(session);
  });

  logoutButton.addEventListener('click', () => {
    sessionStorage.removeItem(STORAGE_KEY);
    idInput.value = '';
    pwInput.value = '';
    setLockedState(null);
    idInput.focus();
  });

  tick();
  setInterval(tick, 1000);
  setLockedState(getSession());
})();
