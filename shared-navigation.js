(() => {
  'use strict';
  const file = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.control-sidebar .side-nav a').forEach(link => {
    link.classList.toggle('active', link.dataset.navFile === file);
  });
})();
