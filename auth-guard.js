(() => {
  'use strict';
  const KEY='hangangbus_portal_preview_auth_v3';
  const here=(location.pathname.split('/').pop()||'dashboard.html').toLowerCase();
  if(['index.html','home.html','repair.html'].includes(here)) return;
  let session=null;
  try{session=JSON.parse(sessionStorage.getItem(KEY)||'null');}catch{}
  if(session&&session.userId) return;
  const allowed=['dashboard.html','detail.html','route.html','jamsu.html','paldang.html','river.html','alerts.html','rain.html','wind.html','tide.html','analysis-dam.html','analysis-bridge.html','analysis-search.html'];
  const next=allowed.includes(here)?here:'dashboard.html';
  location.replace(`./index.html?v=93.0&next=${encodeURIComponent(next)}`);
})();
