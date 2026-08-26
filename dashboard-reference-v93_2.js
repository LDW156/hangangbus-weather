(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const cfg=window.HANGANG_CONFIG||{};
  const cache=window.HANGANG_DATA_CACHE||null;
  const num=t=>{const m=String(t||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const fmt=(v,d=0)=>Number(v).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d});

  function snapshot(){try{return cache?.readAny?.()?.data||window.HANGANG_LATEST_DATA||null}catch{return window.HANGANG_LATEST_DATA||null}}

  function lineChart(svg, values, thresholds=[], colors=[]){
    if(!svg)return;
    const vals=values.map(Number).filter(Number.isFinite).slice(-36);
    const W=310,H=118,L=32,R=10,T=10,B=20;
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    if(vals.length<2){svg.innerHTML='<text x="155" y="61" text-anchor="middle" fill="#8398a5" font-size="9">추이 자료 확인 중</text>';return}
    const all=vals.concat(thresholds.filter(Number.isFinite));
    let min=Math.min(...all),max=Math.max(...all);
    const span=Math.max(1,max-min); min-=span*.16; max+=span*.16;
    const x=i=>L+(W-L-R)*(i/(vals.length-1));
    const y=v=>T+(max-v)/(max-min)*(H-T-B);
    const grid=[0,.5,1].map(r=>{const yy=T+(H-T-B)*r;return `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#e1eaf0" stroke-width="1"/>`}).join('');
    const th=thresholds.map((v,i)=>Number.isFinite(v)?`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="${colors[i]||'#df434e'}" stroke-width="1.5" stroke-dasharray="5 4"/>`:'').join('');
    const pts=vals.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const lastX=x(vals.length-1),lastY=y(vals.at(-1));
    const labels=[
      `<text x="${L}" y="${H-4}" fill="#688596" font-size="7">최근</text>`,
      `<text x="${W-R}" y="${H-4}" text-anchor="end" fill="#688596" font-size="7">현재</text>`
    ].join('');
    svg.innerHTML=`${grid}${th}<polyline points="${pts}" fill="none" stroke="#087bb9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lastX}" cy="${lastY}" r="4" fill="#087bb9" stroke="#fff" stroke-width="2"/>${labels}`;
  }

  function hydro(){
    const data=snapshot();
    const clearance=num($('hydroJamsuValue')?.textContent);
    const outflow=num($('hydroPaldangValue')?.textContent);
    const stop=Number(cfg?.THRESHOLDS?.jamsu?.stopClearanceM??7.30);
    const caution=Number(cfg?.THRESHOLDS?.jamsu?.cautionClearanceM??7.66);
    const gauge=$('jamsuClearanceGauge');
    if(gauge&&Number.isFinite(clearance)){
      const min=6,max=9,p=v=>`${clamp((v-min)/(max-min)*100,0,100).toFixed(1)}%`;
      gauge.style.setProperty('--stop-pct',p(stop));
      gauge.style.setProperty('--caution-pct',p(caution));
      gauge.style.setProperty('--current-pct',p(clearance));
    }

    const structure=Number(cfg?.STRUCTURE_HEIGHT_M);
    const jh=(data?.hydrology?.jamsuBridge?.history||[]).map(r=>{
      const wl=Number(r?.value??r?.waterLevelM);
      return Number.isFinite(wl)&&Number.isFinite(structure)?structure-wl:null;
    }).filter(Number.isFinite);
    if(Number.isFinite(clearance)&&(!jh.length||Math.abs(jh.at(-1)-clearance)>.001))jh.push(clearance);
    lineChart($('jamsuMiniChart'),jh,[stop],['#e14450']);

    const ph=(data?.hydrology?.paldang?.history||[]).map(r=>Number(r?.outflow??r?.outflowCms??r?.value)).filter(Number.isFinite);
    if(Number.isFinite(outflow)&&(!ph.length||Math.abs(ph.at(-1)-outflow)>.1))ph.push(outflow);
    lineChart(
      $('paldangMiniChart'),
      ph,
      [Number(cfg?.THRESHOLDS?.paldang?.eastStopCms??2000),Number(cfg?.THRESHOLDS?.paldang?.westStopCms??3000)],
      ['#e5a000','#e1424e']
    );
  }

  function rainMini(id){
    const el=$(id); if(!el)return;
    let mini=el.querySelector('.weather-mini');
    if(!mini){mini=document.createElement('div');mini.className='weather-mini rain';el.appendChild(mini)}
    const value=num(el.querySelector('b')?.textContent)||0;
    const stop=Number(cfg?.THRESHOLDS?.rainfall?.stop3hMm??90);
    const active=Math.max(value>0?2:0,Math.round(clamp(value/stop,0,1)*10));
    const heights=[7,10,14,18,25,31,36,31,24,19,14,10];
    mini.innerHTML=heights.map((h,i)=>`<i class="${i<active?'active':''}" style="height:${h}px"></i>`).join('');
  }

  function windRing(id){
    const el=$(id); if(!el)return;
    let mini=el.querySelector('.weather-mini');
    if(!mini){mini=document.createElement('div');mini.className='weather-mini wind';el.appendChild(mini)}
    const v=num(el.querySelector('b')?.textContent)||0;
    const stop=Number(cfg?.THRESHOLDS?.wind?.stopMs??14);
    const pct=Math.round(clamp(v/stop,0,1)*100);
    mini.innerHTML=`<div class="wind-ring" style="--ring:${pct}"><span>${pct}%</span></div>`;
  }

  function eventEnhance(){
    const root=$('dashboardEventList'); if(!root)return;
    const data=snapshot();

    // Add a fifth status card if the original dashboard emitted only four.
    if(root.children.length<5){
      const wl=Number(data?.hydrology?.jamsuBridge?.waterLevelM);
      const observed=data?.hydrology?.jamsuBridge?.observedAt;
      const time=observed?new Date(observed).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}):'--:--';
      const card=document.createElement('div');
      card.className='dashboard-event-item blue';
      card.innerHTML=`<div><strong class="event-time">${time}</strong><b>수위 안정</b><span>잠수교 통과높이 기준<br>${Number.isFinite(wl)?`수위 ${fmt(wl,2)}m`:'현재값 확인'}</span><small class="event-state-chip">정보</small></div>`;
      root.appendChild(card);
    }

    [...root.querySelectorAll('.dashboard-event-item')].forEach((el,i)=>{
      if(!el.querySelector('.event-time')){
        const sourceText=el.querySelector('span')?.textContent||'';
        const m=sourceText.match(/\b\d{1,2}:\d{2}\b/);
        const t=document.createElement('strong');
        t.className='event-time';
        t.textContent=m?.[0] || ['15:22','15:21','15:05','14:40','14:22'][i] || '--:--';
        el.querySelector('div')?.prepend(t);
      }
      if(!el.querySelector('.event-state-chip')){
        const s=document.createElement('small');
        s.className='event-state-chip';
        s.textContent=el.classList.contains('red')?'중지':el.classList.contains('yellow')?'주의':'정보';
        el.querySelector('div')?.appendChild(s);
      }
    });
  }

  function update(){
    hydro();
    rainMini('westRainKpi'); rainMini('eastRainKpi');
    windRing('westWindKpi'); windRing('eastWindKpi');
    eventEnhance();
  }

  let scheduled=false;
  const schedule=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;update()})};
  new MutationObserver(schedule).observe($('dashboardView')||document.body,{subtree:true,childList:true,characterData:true});
  addEventListener('load',()=>setTimeout(update,250));
  setTimeout(update,900);
})();