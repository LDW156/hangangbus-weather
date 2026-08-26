(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const cfg=window.HANGANG_CONFIG||{};
  const cache=window.HANGANG_DATA_CACHE||null;
  const num=t=>{const m=String(t||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const snap=()=>{try{return cache?.readAny?.()?.data||window.HANGANG_LATEST_DATA||null}catch{return window.HANGANG_LATEST_DATA||null}};

  function chart(svg,values,thresholds=[],colors=[],labels=[]){
    if(!svg)return;
    const vals=values.map(Number).filter(Number.isFinite);
    const W=320,H=112,L=23,R=8,T=8,B=18;
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    if(vals.length<2){svg.innerHTML='<text x="160" y="56" text-anchor="middle" fill="#8197a3" font-size="9">추이 자료 확인 중</text>';return}
    const all=vals.concat(thresholds.filter(Number.isFinite));
    let min=Math.min(...all),max=Math.max(...all);const spread=Math.max(1,max-min);min-=spread*.16;max+=spread*.16;
    const x=i=>L+(W-L-R)*i/(vals.length-1), y=v=>T+(max-v)/(max-min)*(H-T-B);
    const points=vals.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const grid=[0,.5,1].map(r=>{const yy=T+(H-T-B)*r;const vv=max-(max-min)*r;return `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#e3ebf0"/><text x="${L-4}" y="${yy+3}" text-anchor="end" fill="#7f95a1" font-size="6">${Math.round(vv).toLocaleString('ko-KR')}</text>`}).join('');
    const th=thresholds.map((v,i)=>{if(!Number.isFinite(v))return'';const yy=y(v);return `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="${colors[i]||'#d39a00'}" stroke-width="1.4" stroke-dasharray="5 4"/><text x="${W-R-2}" y="${Math.max(7,yy-3)}" text-anchor="end" fill="${colors[i]||'#d39a00'}" font-size="6.5" font-weight="800">${labels[i]||v}</text>`}).join('');
    const tickIdx=[0,Math.floor((vals.length-1)/2),vals.length-1];
    const ticks=tickIdx.map((i,k)=>`<text x="${x(i)}" y="${H-4}" text-anchor="${k===0?'start':k===2?'end':'middle'}" fill="#8197a3" font-size="6.5">${k===0?'이전':k===1?'중간':'현재'}</text>`).join('');
    const lx=x(vals.length-1),ly=y(vals.at(-1));
    svg.innerHTML=`${grid}${th}<polyline points="${points}" fill="none" stroke="#147fae" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lx}" cy="${ly}" r="3.6" fill="#147fae" stroke="#fff" stroke-width="2"/>${ticks}`;
  }

  function renderHydro(){
    const data=snap();
    const clearance=num($('hydroJamsuValue')?.textContent),outflow=num($('hydroPaldangValue')?.textContent);
    const stop=Number(cfg?.THRESHOLDS?.jamsu?.stopClearanceM??7.30),caution=Number(cfg?.THRESHOLDS?.jamsu?.cautionClearanceM??7.66);
    const gauge=$('jamsuClearanceGauge');
    if(gauge&&Number.isFinite(clearance)){const min=6,max=9.5,p=v=>`${clamp((v-min)/(max-min)*100,0,100).toFixed(1)}%`;gauge.style.setProperty('--stop-pct',p(stop));gauge.style.setProperty('--caution-pct',p(caution));gauge.style.setProperty('--current-pct',p(clearance))}
    const structure=Number(cfg?.STRUCTURE_HEIGHT_M);
    let js=(data?.hydrology?.jamsuBridge?.history||[]).slice(-36).map(r=>{const wl=Number(r?.value??r?.waterLevelM);return Number.isFinite(wl)&&Number.isFinite(structure)?structure-wl:null}).filter(Number.isFinite);if(Number.isFinite(clearance))js.push(clearance);
    chart($('jamsuMiniChart'),js,[stop],['#cf3c47'],['중단 7.30m']);
    let pd=(data?.hydrology?.paldang?.history||[]).slice(-36).map(r=>Number(r?.outflow??r?.outflowCms??r?.value)).filter(Number.isFinite);if(Number.isFinite(outflow))pd.push(outflow);
    chart($('paldangMiniChart'),pd,[Number(cfg?.THRESHOLDS?.paldang?.eastStopCms??2000),Number(cfg?.THRESHOLDS?.paldang?.westStopCms??3000)],['#d6a019','#d3434e'],['동부 2,000','서부 3,000']);
  }

  function weather(id,type){
    const el=$(id);if(!el)return;const value=num(el.querySelector('b')?.textContent)||0;
    el.classList.toggle('wind-card',type==='wind');
    let symbol=el.querySelector('.weather-symbol');if(!symbol){symbol=document.createElement('span');symbol.className='weather-symbol';el.appendChild(symbol)}
    symbol.textContent=type==='rain'?'☂':'≋';
    let mini=el.querySelector('.weather-mini');if(!mini){mini=document.createElement('div');mini.className=`weather-mini ${type}`;el.appendChild(mini)}
    if(type==='rain'){
      const stop=Number(cfg?.THRESHOLDS?.rainfall?.stop3hMm??90),ratio=clamp(value/stop,0,1),active=Math.max(value>0?2:0,Math.round(ratio*10));
      mini.innerHTML=Array.from({length:10},(_,i)=>`<i class="${i<active?'active':''}" style="height:${5+[5,8,12,16,20,17,14,11,8,6][i]}px"></i>`).join('');
      const em=el.querySelector('em');if(em)em.textContent=value<=0?'강수 없음':value<5?'약한 비':'강수 영향 확인';
    }else{
      const stop=Number(cfg?.THRESHOLDS?.wind?.stopMs??14),ratio=clamp(value/stop,0,1),pct=Math.round(ratio*100);
      mini.innerHTML=`<div class="weather-wind-ring" style="--pct:${pct}%"><span>${pct}%</span></div>`;
      const em=el.querySelector('em');if(em)em.textContent=value<4?'약풍 (현재)':value<Number(cfg?.THRESHOLDS?.wind?.cautionMs??8)?'보통 (현재)':'주의 (현재)';
    }
  }

  function update(){renderHydro();weather('westRainKpi','rain');weather('eastRainKpi','rain');weather('westWindKpi','wind');weather('eastWindKpi','wind')}
  let pending=false;new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;update()})}).observe($('dashboardView')||document.body,{subtree:true,childList:true,characterData:true});
  addEventListener('load',()=>setTimeout(update,250));setTimeout(update,800);setInterval(update,10000);
})();
