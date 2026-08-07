(() => {
  'use strict';
  const back=document.getElementById('embeddedDashboardBack');
  back?.addEventListener('click',event=>{
    if (back.tagName === 'A') return;
    event.preventDefault();
    window.location.href='./index.html?v=91.8';
  });

  window.addEventListener('hangangbus-data-rendered',event=>{
    const data=event.detail?.data;
    const calc=event.detail?.calc;
    if(!data||!calc)return;
    const body=document.body;
    const kicker=body.querySelector('.hero-kicker span');
    if(!kicker)return;
    if(body.classList.contains('module-jamsu')){
      kicker.textContent=`현재 ${Number(calc.clearance).toFixed(2)}m · ${calc.jamsu==='normal'?'정상':calc.jamsu==='caution'?'주의':'운항불가'}`;
    }else if(body.classList.contains('module-paldang')){
      const out=Number(data.hydrology?.paldang?.outflowCms);
      kicker.textContent=Number.isFinite(out)?`현재 ${out.toLocaleString('ko-KR')}㎥/s`:'현재값 확인 필요';
    }else if(body.classList.contains('module-river')){
      const j=Number(data.hydrology?.jamsuBridge?.waterLevelM);
      const h=Number(data.hydrology?.hangangBridge?.waterLevelM);
      kicker.textContent=`잠수교 ${Number.isFinite(j)?j.toFixed(2):'-'}m · 한강대교 ${Number.isFinite(h)?h.toFixed(2):'-'}m`;
    }else if(body.classList.contains('module-route')){
      const text=s=>s==='normal'?'정상':s==='caution'?'주의':'운항불가';
      kicker.textContent=`동부 ${text(calc.east)} · 서부 ${text(calc.west)}`;
    }else if(body.classList.contains('module-tide')){
      kicker.textContent=data.tide?.overlapRisk||'중첩위험 확인 중';
    }
  });
})();
