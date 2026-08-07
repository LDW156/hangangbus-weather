(() => {
  'use strict';

  const VERSION = '91.8';
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

  const currentFile = location.pathname.split('/').pop() || 'index.html';
  const legacyTarget = currentFile === 'index.html'
    ? legacyHashRoutes[location.hash]
    : null;

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

  document.querySelectorAll('a[href*="index.html"]').forEach(link => {
    const url = new URL(link.href, location.href);
    if (url.pathname.endsWith('/index.html')) {
      url.hash = '';
      url.search = `?v=${VERSION}`;
      link.href = url.toString();
    }
  });
})();
