(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const cfg=window.HANGANG_CONFIG||{};
  const cache=window.HANGANG_DATA_CACHE||null;
  const num=t=>{const m=String(t||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function snapshot(){try{return cache?.readAny?.()?.data||null}catch{return null}}

  function chart(svg,values,thresholds=[],colors=[]){
    if(!svg)return;
    const vals=values.map(Number).filter(Number.isFinite);
    const W=300,H=92,P=9;
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    if(vals.length<2){svg.innerHTML='<text x="150" y="48" text-anchor="middle" fill="#8197a3" font-size="10">추이 자료 확인 중</text>';return}
    const all=vals.concat(thresholds.filter(Number.isFinite));
    let min=Math.min(...all),max=Math.max(...all);const spread=Math.max(1,max-min);min-=spread*.15;max+=spread*.15;
    const pt=vals.map((v,i)=>`${(P+(W-P*2)*i/(vals.length-1)).toFixed(1)},${(P+(max-v)/(max-min)*(H-P*2)).toFixed(1)}`).join(' ');
    const grid=[0,.5,1].map(r=>{const y=P+(H-P*2)*r;return `<line x1="${P}" x2="${W-P}" y1="${y}" y2="${y}" stroke="#e2ebf0"/>`}).join('');
    const th=thresholds.map((v,i)=>{if(!Number.isFinite(v))return'';const y=P+(max-v)/(max-min)*(H-P*2);return `<line x1="${P}" x2="${W-P}" y1="${y}" y2="${y}" stroke="${colors[i]||'#d39a00'}" stroke-width="1.5" stroke-dasharray="5 4"/>`}).join('');
    const last=pt.split(' ').at(-1).split(',');
    svg.innerHTML=`${grid}${th}<polyline points="${pt}" fill="none" stroke="#147fae" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="4" fill="#147fae" stroke="#fff" stroke-width="2"/>`;
  }

  function renderHydro(){
    const snap=snapshot();
    const clearance=num($('hydroJamsuValue')?.textContent);
    const outflow=num($('hydroPaldangValue')?.textContent);
    const stop=Number(cfg?.THRESHOLDS?.jamsu?.stopClearanceM??7.30);
    const caution=Number(cfg?.THRESHOLDS?.jamsu?.cautionClearanceM??7.66);
    const gauge=$('jamsuClearanceGauge');
    if(gauge&&Number.isFinite(clearance)){
      const min=6,max=9.5,p=v=>`${clamp((v-min)/(max-min)*100,0,100).toFixed(1)}%`;
      gauge.style.setProperty('--stop-pct',p(stop));gauge.style.setProperty('--caution-pct',p(caution));gauge.style.setProperty('--current-pct',p(clearance));
    }

    const structure=Number(cfg?.STRUCTURE_HEIGHT_M);
    let js=(snap?.hydrology?.jamsuBridge?.history||[]).slice(-36).map(r=>{const wl=Number(r?.value??r?.waterLevelM);return Number.isFinite(wl)&&Number.isFinite(structure)?structure-wl:null}).filter(Number.isFinite);
    if(Number.isFinite(clearance))js.push(clearance);
    chart($('jamsuMiniChart'),js,[stop],['#cf3c47']);

    let pd=(snap?.hydrology?.paldang?.history||[]).slice(-36).map(r=>Number(r?.outflow??r?.outflowCms??r?.value)).filter(Number.isFinite);
    if(Number.isFinite(outflow))pd.push(outflow);
    chart($('paldangMiniChart'),pd,[Number(cfg?.THRESHOLDS?.paldang?.eastStopCms??2000),Number(cfg?.THRESHOLDS?.paldang?.westStopCms??3000)],['#d6a019','#d3434e']);
  }

  function weather(id,type){
    const el=$(id);if(!el)return;
    let mini=el.querySelector('.weather-mini');if(!mini){mini=document.createElement('div');mini.className=`weather-mini ${type}`;el.appendChild(mini)}
    const v=num(el.querySelector('b')?.textContent)||0;
    if(type==='rain'){
      const stop=Number(cfg?.THRESHOLDS?.rainfall?.stop3hMm??90),active=Math.max(v>0?1:0,Math.round(clamp(v/stop,0,1)*10));
      mini.innerHTML=Array.from({length:10},(_,i)=>`<i class="${i<active?'active':''}" style="height:${4+((i*7)%12)}px"></i>`).join('');
    }else{
      const stop=Number(cfg?.THRESHOLDS?.wind?.stopMs??14),ratio=clamp(v/stop,0,1);
      mini.innerHTML=`<div class="weather-wind-track" style="--pct:${(ratio*100).toFixed(0)}%"><i></i></div><small>${(ratio*100).toFixed(0)}%</small>`;
    }
  }

  function events(){
    document.querySelectorAll('.dashboard-event-item').forEach(el=>{
      if(el.querySelector('.event-state-chip'))return;
      const s=document.createElement('small');s.className='event-state-chip';s.textContent=el.classList.contains('red')?'중지 기준':el.classList.contains('yellow')?'주의':'정보';el.querySelector('div')?.appendChild(s);
    });
  }

  function update(){renderHydro();weather('westRainKpi','rain');weather('eastRainKpi','rain');weather('westWindKpi','wind');weather('eastWindKpi','wind');events()}
  new MutationObserver(()=>requestAnimationFrame(update)).observe($('dashboardView')||document.body,{subtree:true,childList:true,characterData:true});
  addEventListener('load',()=>setTimeout(update,250));setTimeout(update,900);setInterval(update,10000);
})();