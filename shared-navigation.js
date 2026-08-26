(() => {
  'use strict';
  const VERSION='93.1';
  const SECURE_ORIGIN='https://hangangbus-secure-portal.akchdleodns.workers.dev';
  const isSecure=location.hostname.endsWith('.workers.dev') || location.hostname==='hangangbus-secure-portal.akchdleodns.workers.dev';
  const currentFile=location.pathname.split('/').pop()||'index.html';
  const legacyHashRoutes={'#analysis-dam':'analysis-dam.html','#analysis-bridge':'analysis-bridge.html','#analysis-search':'analysis-search.html','#history':'analysis-dam.html'};
  if(window.top!==window.self){window.top.location.replace(window.location.href);return}
  if(currentFile==='index.html'&&legacyHashRoutes[location.hash]){location.replace(`./${legacyHashRoutes[location.hash]}?v=${VERSION}`);return}
  sessionStorage.removeItem('hangangbus-view');
  const canonical=file=>`./${file}?v=${VERSION}`;

  document.querySelectorAll('.control-sidebar .side-nav a[data-nav-file]').forEach(link=>{
    const target=link.dataset.navFile;link.classList.toggle('active',target===currentFile);link.href=canonical(target);link.addEventListener('click',e=>{e.preventDefault();location.assign(canonical(target))});
  });

  const nav=document.querySelector('.control-sidebar .side-nav');
  if(nav&&!document.getElementById('hbHomeNav')){
    const a=document.createElement('a');a.id='hbHomeNav';a.className='hb-home-link';a.href='./home.html?v=93.1';a.innerHTML='<span class="side-icon">⌂</span><span>메인화면</span>';nav.prepend(a);
  }

  const style=document.createElement('style');style.textContent=`
    .hb-home-link{margin-bottom:7px!important;border:1px solid rgba(126,190,223,.20)!important;background:rgba(255,255,255,.055)!important}.hb-home-link:hover{background:rgba(255,255,255,.12)!important}
    .hb-account-ui{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-right:7px;margin-right:2px;border-right:1px solid #d6e4ec}
    .hb-account-user{padding:6px 9px;border-radius:8px;background:#eef6fa;color:#607b89;font-size:8px;font-weight:850;white-space:nowrap}.hb-account-user b{color:#0c5b7d;font-size:9px}
    .hb-account-ui a,.hb-account-ui button{display:inline-flex;align-items:center;justify-content:center;min-height:29px;padding:5px 9px;border:1px solid #bdd6e5;border-radius:8px;background:#fff;color:#145c7c;text-decoration:none;font-size:8px;font-weight:900;cursor:pointer;white-space:nowrap}.hb-account-ui .logout{border-color:#dbc6c8;color:#9a4451}.hb-account-ui .secure-login{border-color:#76b9da;background:#edf8fd;color:#0d688f}
    @media(max-width:1100px){.hb-account-ui{width:100%;justify-content:flex-end;border-right:0;padding-right:0}}
  `;document.head.appendChild(style);

  const host=document.querySelector('.control-header-actions,.autonomy-actions,.history-header-actions,.header-right');
  if(host&&!document.getElementById('hbAccountUi')){
    const box=document.createElement('div');box.id='hbAccountUi';box.className='hb-account-ui';
    if(isSecure){
      box.innerHTML='<span class="hb-account-user">로그인 <b id="hbAccountName">확인 중</b> <span id="hbAccountRole"></span></span><a href="/home.html">메인</a><a id="hbAdminUsers" href="/admin-users.html" hidden>사용자 관리</a><button class="logout" id="hbLogout" type="button">로그아웃</button>';
    }else{
      box.innerHTML=`<span class="hb-account-user">공개 미리보기</span><a href="./home.html?v=${VERSION}">메인</a><a class="secure-login" href="${SECURE_ORIGIN}/home.html">보안포털 로그인</a>`;
    }
    host.prepend(box);
  }

  if(isSecure){
    const verify=async()=>{
      try{
        const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}});if(!r.ok)throw 0;const j=await r.json();if(!j.ok||!j.user)throw 0;
        const name=document.getElementById('hbAccountName'),role=document.getElementById('hbAccountRole'),admin=document.getElementById('hbAdminUsers');if(name)name.textContent=j.user.displayName||j.user.userId;if(role)role.textContent=j.user.role==='admin'?'(관리자)':`(${j.user.role||'사용자'})`;if(admin)admin.hidden=j.user.role!=='admin';
      }catch{const ret=location.pathname+location.search;location.replace('/home.html?return='+encodeURIComponent(ret))}
    };
    document.getElementById('hbLogout')?.addEventListener('click',()=>location.assign('/logout'));
    addEventListener('pageshow',e=>{if(e.persisted)verify()});verify();
  }
})();
