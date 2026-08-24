(() => {
  'use strict';
  const clock = document.getElementById('portalClock');
  const tick = () => {
    const now = new Date();
    clock.textContent = new Intl.DateTimeFormat('ko-KR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(now);
  };
  tick();
  setInterval(tick, 1000);
})();
