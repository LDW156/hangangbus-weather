(() => {
  'use strict';

  const VERSION = '93.2';
  const SECURE_ORIGIN = 'https://hangangbus-secure-portal.akchdleodns.workers.dev';
  const IS_SECURE = location.hostname === 'hangangbus-secure-portal.akchdleodns.workers.dev' ||
                    location.hostname.endsWith('.workers.dev');
  const currentFile = location.pathname.split('/').pop() || 'index.html';

  const legacyHashRoutes = {
    '#analysis-dam':'analysis-dam.html',
    '#analysis-bridge':'analysis-bridge.html',
    '#analysis-search':'analysis-search.html',
    '#history':'analysis-dam.html'
  };

  if (window.top !== window.self) {
    window.top.location.replace(window.location.href);
    return;
  }

  const legacyTarget = currentFile === 'index.html' ? legacyHashRoutes[location.hash] : null;
  if (legacyTarget) {
    location.replace(`./${legacyTarget}?v=${VERSION}`);
    return;
  }

  sessionStorage.removeItem('hangangbus-view');

  const canonical = file => `./${file}?v=${VERSION}`;
  document.querySelectorAll('.control-sidebar .side-nav a[data-nav-file]').forEach(link => {
    const targetFile = link.dataset.navFile;
    link.classList.toggle('active', targetFile === currentFile);
    link.setAttribute('href', canonical(targetFile));
    link.addEventListener('click', event => {
      event.preventDefault();
      location.assign(canonical(targetFile));
    });
  });

  const style = document.createElement('style');
  style.textContent = `
    .hb-home-link{margin-bottom:8px!important;border:1px solid rgba(143,201,230,.22)!important;background:rgba(255,255,255,.055)!important}
    .hb-home-link:hover{background:rgba(255,255,255,.12)!important}
    .hb-account-ui{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;margin-right:4px}
    .hb-account-user{display:inline-flex;align-items:center;gap:5px;min-height:30px;padding:5px 9px;border-radius:8px;background:#eef6fa;color:#527080;font-size:9px;font-weight:850;white-space:nowrap}
    .hb-account-user b{color:#0b5275;font-size:10px}
    .hb-account-ui a,.hb-account-ui button{display:inline-flex;align-items:center;justify-content:center;min-height:30px;padding:5px 9px;border:1px solid #bdd6e5;border-radius:8px;background:#fff;color:#145c7c;text-decoration:none;font-size:9px;font-weight:900;cursor:pointer;white-space:nowrap}
    .hb-account-ui .logout{border-color:#ddc8ca;color:#9a4654}
    .hb-account-ui .admin[hidden]{display:none!important}
    @media(max-width:1180px){.hb-account-ui{width:100%;justify-content:flex-end}}
  `;
  document.head.appendChild(style);

  const sideNav = document.querySelector('.control-sidebar .side-nav');
  if (sideNav && !document.getElementById('hbHomeLink')) {
    const a = document.createElement('a');
    a.id = 'hbHomeLink';
    a.className = 'hb-home-link';
    a.href = IS_SECURE ? '/home.html' : './home.html';
    a.innerHTML = '<span class="side-icon">⌂</span><span>메인화면</span>';
    sideNav.prepend(a);
  }

  const actions = document.querySelector('.control-header-actions,.autonomy-actions,.history-header-actions,.header-right');
  if (actions && !document.getElementById('hbAccountUi')) {
    const box = document.createElement('div');
    box.id = 'hbAccountUi';
    box.className = 'hb-account-ui';

    if (IS_SECURE) {
      box.innerHTML = `
        <span class="hb-account-user">로그인 <b id="hbAccountName">확인 중</b><span id="hbAccountRole"></span></span>
        <a href="/home.html">메인</a>
        <a class="admin" id="hbAdminUsers" href="/admin-users.html" hidden>사용자 관리</a>
        <button class="logout" id="hbLogout" type="button">로그아웃</button>`;
    } else {
      box.innerHTML = `
        <span class="hb-account-user">공개 미리보기</span>
        <a href="./home.html">메인</a>
        <a href="${SECURE_ORIGIN}/home.html">보안포털 로그인</a>`;
    }
    actions.prepend(box);
  }

  async function loadAuth(){
    if (!IS_SECURE) return;
    try {
      const r = await fetch('/api/auth/me', {credentials:'same-origin', cache:'no-store'});
      if (!r.ok) throw new Error('AUTH_REQUIRED');
      const j = await r.json();
      if (!j.ok || !j.user) throw new Error('AUTH_REQUIRED');
      const name = document.getElementById('hbAccountName');
      const role = document.getElementById('hbAccountRole');
      const admin = document.getElementById('hbAdminUsers');
      if (name) name.textContent = j.user.displayName || j.user.userId || '승인 사용자';
      if (role) role.textContent = j.user.role === 'admin' ? ' · 관리자' : '';
      if (admin) admin.hidden = j.user.role !== 'admin';
    } catch {
      const ret = location.pathname + location.search + location.hash;
      location.replace('/home.html?return=' + encodeURIComponent(ret));
    }
  }

  document.getElementById('hbLogout')?.addEventListener('click', () => location.assign('/logout'));
  window.addEventListener('pageshow', e => { if (e.persisted) loadAuth(); });
  loadAuth();
})();