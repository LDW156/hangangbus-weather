(() => {
  'use strict';
  function setActive(){
    const file=location.pathname.split('/').pop()||'index.html';
    const hash=location.hash.replace(/^#/,'');
    const links=[...document.querySelectorAll('.control-sidebar .side-nav a')];
    links.forEach(link=>link.classList.remove('active'));
    let active=null;
    if(file==='index.html'&&/^analysis-(dam|bridge|search)$/.test(hash)) active=document.querySelector(`.control-sidebar a[data-nav-hash="${hash}"]`);
    if(!active) active=document.querySelector(`.control-sidebar a[data-nav-file="${file}"]`);
    if(!active&&file==='index.html') active=document.querySelector('.control-sidebar a[data-nav-file="index.html"]');
    active?.classList.add('active');
  }
  setActive();
  window.addEventListener('hashchange',setActive);
})();
