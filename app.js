(() => {
  'use strict';
  const cfg = window.HANGANG_CONFIG;
  let data = null;
  let scenario = 'normal';
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d=0) => Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d});
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const last = (arr) => arr[arr.length-1];
  const first = (arr) => arr[0];
  const statusText = {normal:'운항 가능',caution:'운항 주의',stop:'운항 불가'};

  const toDate = (v) => v ? new Date(v) : null;
  const timeText = (v) => {
    const d=toDate(v); if(!d || Number.isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});
  };
  const dateTimeText = (v) => {
    const d=toDate(v); if(!d || Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  };
  const fullDateTimeText = (v) => {
    const d=toDate(v); if(!d || Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  };
  const signed = (n,d=1,unit='') => `${n>0?'+':''}${fmt(n,d)}${unit}`;
  const deltaClass = (n, inverse=false) => {
    const bad = inverse ? n<0 : n>0;
    const good = inverse ? n>0 : n<0;
    return bad?'warn':good?'good':'';
  };
  const historyValue = (history, steps, key='value') => {
    const idx=Math.max(0,history.length-1-steps);
    return Number(history[idx]?.[key]);
  };
  const historyDelta = (history, steps, key='value') => Number(last(history)?.[key])-historyValue(history,steps,key);
  const durationText = (from,to) => {
    const a=toDate(from),b=toDate(to); if(!a||!b) return '-';
    let mins=Math.round((b-a)/60000), sign=mins<0?'-':''; mins=Math.abs(mins);
    const h=Math.floor(mins/60),m=mins%60;
    return `${sign}${h?`${h}시간 `:''}${m}분`;
  };

  async function loadData(){
    data = structuredClone(window.HANGANG_DEMO_DATA[scenario]);

    const liveSources=[];
    const setupSources=[];
    const errors=[];

    if(cfg.HRFCO?.ENABLED){
      if(window.HRFCO?.isConfigured()){
        try{
          const live = await window.HRFCO.loadHydrology();
          data.hydrology = {
            paldang: live.paldang,
            jamsuBridge: live.jamsuBridge,
            hangangBridge: live.hangangBridge
          };
          data.meta.dataTimes.hydrology = live.fetchedAt;
          data.health = (data.health || []).filter(x => !['한강수위','팔당댐'].includes(x.name));
          data.health.unshift(
            {name:'한강수위',status:'normal',updatedAt:live.jamsuBridge.observedAt,intervalMinutes:10},
            {name:'팔당댐',status:'normal',updatedAt:live.paldang.observedAt,intervalMinutes:10}
          );
          liveSources.push('수문');
        }catch(err){
          errors.push(`수문: ${err.message}`);
        }
      }else{
        setupSources.push('수문');
      }
    }

    if(cfg.KMA?.ENABLED){
      if(window.KMA?.isConfigured()){
        try{
          const live = await window.KMA.loadWeather();
          data.weather = live.weather;
          data.alerts = live.alerts;
          data.meta.dataTimes.weatherObservation = live.observedAt;
          data.meta.dataTimes.weatherForecastIssued = live.forecastIssuedAt;
          data.health = (data.health || []).filter(x => !['기상관측','기상예보','기상특보'].includes(x.name));
          data.health.push(
            {name:'기상관측',status:'normal',updatedAt:live.observedAt,intervalMinutes:60},
            {name:'기상예보',status:'normal',updatedAt:live.forecastIssuedAt,intervalMinutes:60},
            {name:'기상특보',status:'normal',updatedAt:live.fetchedAt,intervalMinutes:10}
          );
          liveSources.push('기상');
        }catch(err){
          errors.push(`기상: ${err.message}`);
        }
      }else{
        setupSources.push('기상');
      }
    }

    data.meta.generatedAt = new Date().toISOString();
    data.meta.mode = liveSources.length ? 'hybrid' : 'demo';

    if(liveSources.length){
      $('modeBadge').textContent='HYBRID';
      const liveText=`실데이터: ${liveSources.join('·')}`;
      const demoText=`데모 유지: ${['수문','기상','조석'].filter(x=>!liveSources.includes(x)).join('·')}`;
      if(errors.length) setBanner('error',`${liveText} / ${demoText} / 오류 ${errors.join(' | ')}`);
      else setBanner('live',`${liveText} / ${demoText}. 각 카드의 관측·예보 시각을 확인하십시오.`);
    }else if(errors.length){
      $('modeBadge').textContent='ERROR';
      setBanner('error',`${errors.join(' | ')} · 현재 표시값은 데모이므로 운항판단에 사용하지 마십시오.`);
    }else{
      $('modeBadge').textContent=setupSources.length?'SETUP':'DEMO';
      setBanner('demo',`${setupSources.join('·')} 실데이터 설정 전입니다. GitHub 공용 설정파일을 확인하십시오. 조석은 데모 데이터입니다.`);
    }

    render();
  }

  function setBanner(type,text){
    $('systemBanner').className=`system-banner ${type}`;
    $('systemBanner').textContent=text;
  }

  function compute(){
    const t=cfg.THRESHOLDS;
    const wl=data.hydrology.jamsuBridge.waterLevelM;
    const clearance=cfg.STRUCTURE_HEIGHT_M-wl;
    const out=data.hydrology.paldang.outflowCms;
    const outHist=data.hydrology.paldang.history;
    const rising=historyDelta(outHist,Math.min(6,outHist.length-1),'outflow')>0;
    const winds=data.weather.windStations;
    const eastW=winds.filter(x=>x.sector==='east');
    const westW=winds.filter(x=>x.sector==='west');
    const max=(arr,key)=>{
      const values=arr.map(x=>x[key]).filter(v=>v!==null&&v!==undefined&&v!=='').map(Number).filter(Number.isFinite);
      return values.length?Math.max(...values):null;
    };
    const windStats=(arr)=>({speed:max(arr,'speed')??0,gust:max(arr,'gust')});
    const eastStats=windStats(eastW), westStats=windStats(westW);
    const officialWarning=data.alerts.some(a=>a.source==='official'&&a.level==='warning');
    const officialAdvisory=data.alerts.some(a=>a.source==='official'&&a.level==='advisory');

    let jamsu='normal';
    if(wl>=t.jamsu.stopLevelM || clearance<=t.jamsu.stopClearanceM) jamsu='stop';
    else if(wl>=t.jamsu.cautionLevelM || clearance<=t.jamsu.cautionClearanceM) jamsu='caution';

    let east='normal',west='normal';
    const eastReasons=[], westReasons=[];
    if(jamsu==='stop'){east='stop';eastReasons.push(`잠수교 ${timeText(data.hydrology.jamsuBridge.observedAt)} · 통과높이 ${fmt(clearance,2)}m`)}
    else if(jamsu==='caution'){east='caution';eastReasons.push(`잠수교 ${timeText(data.hydrology.jamsuBridge.observedAt)} · ${fmt(clearance,2)}m 주의`)}
    else eastReasons.push(`잠수교 ${timeText(data.hydrology.jamsuBridge.observedAt)} · ${fmt(clearance,2)}m 정상`);

    if(out>=t.paldang.eastStopCms && rising){east='stop';eastReasons.push(`팔당 ${timeText(data.hydrology.paldang.observedAt)} · ${fmt(out)}㎥/s 증가`)}
    else if(out>=t.paldang.eastCautionCms){if(east==='normal')east='caution';eastReasons.push(`팔당 ${timeText(data.hydrology.paldang.observedAt)} · ${fmt(out)}㎥/s 접근`)}
    else eastReasons.push(`팔당 ${timeText(data.hydrology.paldang.observedAt)} · ${fmt(out)}㎥/s`);

    if(out>=t.paldang.westStopCms){west='stop';westReasons.push(`팔당 ${timeText(data.hydrology.paldang.observedAt)} · ${fmt(out)}㎥/s 초과`)}
    else if(out>=t.paldang.westCautionCms){west='caution';westReasons.push(`팔당 ${timeText(data.hydrology.paldang.observedAt)} · ${fmt(out)}㎥/s 접근`)}
    else westReasons.push(`팔당 ${timeText(data.hydrology.paldang.observedAt)} · ${fmt(out)}㎥/s 기준 미만`);

    const eastStopWind=eastStats.speed>=t.wind.stopMs||(eastStats.gust!==null&&eastStats.gust>=t.wind.gustStopMs);
    const eastCautionWind=eastStats.speed>=t.wind.cautionMs||(eastStats.gust!==null&&eastStats.gust>=t.wind.gustCautionMs);
    const eastWindText=eastStats.gust===null?`동부 ${timeText(eastW[0]?.observedAt)} · 풍속 ${fmt(eastStats.speed,1)}m/s`:`동부 ${timeText(eastW[0]?.observedAt)} · 순간 ${fmt(eastStats.gust,1)}m/s`;
    if(eastStopWind){east='stop';eastReasons.push(eastWindText)}
    else if(eastCautionWind){if(east==='normal')east='caution';eastReasons.push(eastWindText)}
    else eastReasons.push(eastWindText);

    const westStopWind=westStats.speed>=t.wind.stopMs||(westStats.gust!==null&&westStats.gust>=t.wind.gustStopMs);
    const westCautionWind=westStats.speed>=t.wind.cautionMs||(westStats.gust!==null&&westStats.gust>=t.wind.gustCautionMs);
    const westWindText=westStats.gust===null?`서부 ${timeText(westW[0]?.observedAt)} · 풍속 ${fmt(westStats.speed,1)}m/s`:`서부 ${timeText(westW[0]?.observedAt)} · 순간 ${fmt(westStats.gust,1)}m/s`;
    if(westStopWind){west='stop';westReasons.push(westWindText)}
    else if(westCautionWind){if(west==='normal')west='caution';westReasons.push(westWindText)}
    else westReasons.push(westWindText);

    if(officialWarning){east='stop';west='stop'}
    else if(officialAdvisory){if(east==='normal')east='caution';if(west==='normal')west='caution'}
    westReasons.push(`조석 ${timeText(data.tide.referenceAt)} · ${data.tide.phase}, 위험 ${data.tide.overlapRisk}`);
    return {jamsu,clearance,east,west,eastReasons:eastReasons.slice(0,4),westReasons:westReasons.slice(0,4),rising};
  }

  function render(){
    const calc=compute();
    renderRoutes(calc);renderJamsu(calc);renderDam(calc);renderAlerts();renderRain();renderWind();renderRiver();renderTide();renderHealth();
    $('updatedAt').textContent=`판단 기준 ${dateTimeText(data.meta.generatedAt)}`;
  }

  function routeCard(name,status,reasons){
    return `<div class="route-card-time">판단시각 ${dateTimeText(data.meta.generatedAt)}</div><div class="route-name">${esc(name)}</div><div class="route-status">${statusText[status]}</div><ul class="route-reasons">${reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`;
  }
  function renderRoutes(c){
    $('eastRoute').className=`route-card ${c.east}`;$('eastRoute').innerHTML=routeCard('동부선',c.east,c.eastReasons);
    $('westRoute').className=`route-card ${c.west}`;$('westRoute').innerHTML=routeCard('서부선',c.west,c.westReasons);
    if(cfg.SHOW_DEMO_CONTROLS&&cfg.DATA_MODE==='demo'){$('demoControls').hidden=false;document.querySelectorAll('[data-scenario]').forEach(b=>b.classList.toggle('active',b.dataset.scenario===scenario));}
  }

  function comparisonCell(label,time,current,previous,digits=2,unit='m',inverse=false){
    const d=current-previous;
    return `<div class="comparison-cell"><span>${label} · ${time}</span><b>${fmt(previous,digits)}${unit}</b><em class="${deltaClass(d,inverse)}">현재 대비 ${signed(d,digits,unit)}</em></div>`;
  }

  function renderJamsu(c){
    const j=data.hydrology.jamsuBridge,h=j.history;
    const cur=j.waterLevelM;
    const d10=historyDelta(h,1),d30=historyDelta(h,3),d60=historyDelta(h,6);
    const clearance10=cfg.STRUCTURE_HEIGHT_M-historyValue(h,1);
    $('jamsuHero').className=`jamsu-hero ${c.jamsu}`;
    $('jamsuHero').innerHTML=`
      <div class="data-time">관측 ${fullDateTimeText(j.observedAt)} · ${j.intervalMinutes}분 간격</div>
      <div><div class="jamsu-label">현재 잠수교 통과높이</div><div class="clearance">${fmt(c.clearance,2)}m</div><div class="jamsu-status">${statusText[c.jamsu]}</div></div>
      <div class="detail-grid three">
        <div class="detail"><span>현재 수위 · ${timeText(j.observedAt)}</span><b>${fmt(cur,2)}m</b></div>
        <div class="detail"><span>10분 수위변화</span><b class="${deltaClass(d10)}">${signed(d10,2,'m')}</b></div>
        <div class="detail"><span>10분 통과높이 변화</span><b class="${deltaClass(c.clearance-clearance10,true)}">${signed(c.clearance-clearance10,2,'m')}</b></div>
        <div class="detail"><span>30분 수위변화</span><b class="${deltaClass(d30)}">${signed(d30,2,'m')}</b></div>
        <div class="detail"><span>1시간 수위변화</span><b class="${deltaClass(d60)}">${signed(d60,2,'m')}</b></div>
        <div class="detail"><span>불가 기준</span><b>7.30m</b></div>
      </div>
      <div class="comparison-grid">
        ${comparisonCell('10분 전',timeText(h[h.length-2].timestamp),cur,historyValue(h,1),2,'m')}
        ${comparisonCell('30분 전',timeText(h[h.length-4].timestamp),cur,historyValue(h,3),2,'m')}
        ${comparisonCell('1시간 전',timeText(h[h.length-7].timestamp),cur,historyValue(h,6),2,'m')}
      </div>`;
    $('jamsuChartMeta').textContent=`${timeText(h[0].timestamp)}~${timeText(last(h).timestamp)} · 10분 간격`;

    const chartValues = h
      .map(row => Number(row.value))
      .filter(Number.isFinite);
    const referenceValues = [4.10, 4.46];
    const rawMin = Math.min(...chartValues, ...referenceValues);
    const rawMax = Math.max(...chartValues, ...referenceValues);
    const rawSpan = Math.max(rawMax - rawMin, 0.40);
    const padding = Math.max(0.10, rawSpan * 0.10);
    const chartMin = Math.max(0, Math.floor((rawMin - padding) * 10) / 10);
    const chartMax = Math.ceil((rawMax + padding) * 10) / 10;

    lineChart($('jamsuChart'),h,{
      key:'value',
      min:chartMin,
      max:chartMax,
      lines:[
        {v:4.10,color:'#f1c75b'},
        {v:4.46,color:'#ef646b'}
      ],
      color:'#55b7ec'
    });
  }

  function compareRows(history){
    const indexes=[6,3,1,0].filter((v,i,a)=>v<history.length && a.indexOf(v)===i).reverse();
    return indexes.map(steps=>{
      const p=history[history.length-1-steps];
      const label=steps===0?'현재':steps===1?'10분 전':steps===3?'30분 전':steps===6?'1시간 전':`${steps*10}분 전`;
      return `<tr class="${steps===0?'current-row':''}"><td>${label}</td><td>${esc(p.time)}</td><td>${fmt(p.inflow)}㎥/s</td><td>${fmt(p.outflow)}㎥/s</td><td>${signed(p.inflow-p.outflow,0,'')}</td></tr>`;
    }).join('');
  }

  function renderDam(c){
    const p=data.hydrology.paldang,h=p.history;
    const out10=historyDelta(h,1,'outflow'),out30=historyDelta(h,3,'outflow'),out60=historyDelta(h,6,'outflow');
    const in10=historyDelta(h,1,'inflow'),in60=historyDelta(h,6,'inflow');
    const metrics=[
      ['현재 유입량',`${fmt(p.inflowCms)}㎥/s`,`${timeText(p.observedAt)} 관측 · 10분 ${signed(in10,0)}`],
      ['현재 방류량',`${fmt(p.outflowCms)}㎥/s`,`${timeText(p.observedAt)} 관측 · 10분 ${signed(out10,0)}`],
      ['유입-방류',`${signed(p.inflowCms-p.outflowCms,0,'㎥/s')}`,p.inflowCms>p.outflowCms?'저류 증가':'저류 감소'],
      ['1시간 방류변화',`${signed(out60,0,'㎥/s')}`,`30분 ${signed(out30,0)} · 유입 ${signed(in60,0)}`]
    ];
    $('damMetrics').innerHTML=metrics.map((m,i)=>`<div class="metric"><div class="data-time">기준 ${dateTimeText(p.observedAt)}</div><div class="metric-label">${m[0]}</div><div class="metric-value ${i===1&&p.outflowCms>=cfg.THRESHOLDS.paldang.eastCautionCms?'warn':''}">${m[1]}</div><div class="metric-sub">${m[2]}</div></div>`).join('');
    $('damTrendText').textContent=`${timeText(h[0].timestamp)}~${timeText(last(h).timestamp)} · 10분 간격`;
    damChart($('damChart'),h);
    $('damComparisonBody').innerHTML=compareRows(h);
  }

  function renderAlerts(){
    const root=$('alertList');
    if(!data.alerts.length){root.innerHTML=`<div class="empty-card">${dateTimeText(data.meta.generatedAt)} 기준 · 현재 표시할 기상특보 또는 내부 사전경보가 없습니다.</div>`;return;}
    root.innerHTML=data.alerts.map(a=>`<article class="alert-card ${esc(a.source==='internal'?'internal':a.level)}"><div class="alert-top"><div><div class="alert-tags"><span class="tag ${a.source==='internal'?'internal':''}">${a.source==='official'?'기상청 공식':a.source==='preliminary'?'기상청 예비':'한강버스 내부'}</span><span class="tag">${esc(a.area)}</span></div><h3>${esc(a.title)}</h3></div><span class="alert-time">발표 ${dateTimeText(a.issuedAt)}</span></div><p>${esc(a.message)}</p><div class="alert-period"><span>발표 ${fullDateTimeText(a.issuedAt)}</span><b>발효·예상 ${fullDateTimeText(a.effectiveAt)}</b></div></article>`).join('');
  }

  function renderRain(){
    const names={west:'서부선',east:'동부선'};
    $('rainCards').innerHTML=['west','east'].map(k=>{
      const r=data.weather.rainfall[k], max=Math.max(1,...r.timeline.map(x=>x.amount));
      const bars=r.timeline.map(x=>`<div class="bar-wrap ${x.type}"><span class="bar-value">${fmt(x.amount,x.type==='current'?1:0)}</span><div class="bar" style="height:${Math.max(2,x.amount/max*100)}%" title="${x.label} ${x.amount}mm"></div><small>${x.label}</small></div>`).join('');
      const rows=r.timeline.map(x=>`<div class="hour-cell ${x.type}"><span>${x.label}</span><b>${fmt(x.amount,x.type==='current'?1:0)}mm</b><em>${x.type==='forecast'?'예보':x.type==='current'?'현재':'관측'}</em></div>`).join('');
      return `<article class="sector-card"><div class="data-time">현재 관측 ${dateTimeText(r.observedAt)} · 예보 발표 ${dateTimeText(r.forecastIssuedAt)} · 1시간 간격</div><div class="sector-title"><h3>${names[k]}</h3><span>${timeText(r.observedAt)} 현재 ${fmt(r.currentRate,1)}mm/h</span></div><div class="rain-summary">${[['3시간',r.next3h],['6시간',r.next6h],['12시간',r.next12h],['24시간',r.next24h],['현재',r.currentRate]].map(x=>`<div class="rain-item"><b>${fmt(x[1],x[0]==='현재'?1:0)}</b><span>${x[0]} ${x[0]==='현재'?'mm/h':'mm'}</span></div>`).join('')}</div><div class="bars">${bars}</div><div class="bar-legend"><span class="obs-dot"></span>관측 <span class="current-dot"></span>현재 <span class="forecast-dot"></span>예보</div><div class="hour-grid">${rows}</div></article>`;
    }).join('');
  }

  function windLevel(w){
    const t=cfg.THRESHOLDS.wind;
    const hasGust=w.gust!==null&&w.gust!==undefined&&w.gust!=='';
    const gust=hasGust?Number(w.gust):null;
    if(w.speed>=t.stopMs||(gust!==null&&Number.isFinite(gust)&&gust>=t.gustStopMs))return'danger';
    if(w.speed>=t.cautionMs||(gust!==null&&Number.isFinite(gust)&&gust>=t.gustCautionMs))return'warn';
    return'good';
  }
  function windCompare(label,x,current){
    if(!x) return `<div class="wind-compare unavailable"><span>${label}</span><b>자료 없음</b><em>별도 AWS 관측 연결 예정</em></div>`;
    const d=Number(x.speed)-Number(current.speed);
    const gustText=(x.gust!==null&&x.gust!==undefined&&x.gust!==''&&Number.isFinite(Number(x.gust)))?`순간 ${fmt(x.gust,1)} · `:'';
    return `<div class="wind-compare"><span>${label} · ${timeText(x.time)}</span><b>${esc(x.direction)} ${fmt(x.speed,1)}m/s</b><em>${gustText}${signed(d,1,'m/s')}</em></div>`;
  }
  function renderWind(){
    $('windGrid').innerHTML=data.weather.windStations.map(w=>{
      const gustText=(w.gust!==null&&w.gust!==undefined&&w.gust!==''&&Number.isFinite(Number(w.gust)))?`순간 ${fmt(w.gust,1)}m/s`:'순간풍속 미연결';
      const interval=w.sourceLabel?.includes('초단기')?'실황 1시간 / 예보 1시간':'관측 10분 / 예보 1시간';
      return `<article class="station-card"><div class="data-time">관측 ${dateTimeText(w.observedAt)} · ${interval}</div><div class="station-head"><h3>${esc(w.name)}</h3><span class="sector-pill">${w.sector==='east'?'동부':'서부'}</span></div><div class="wind-main ${windLevel(w)}">${fmt(w.speed,1)}m/s</div><div class="wind-sub">${timeText(w.observedAt)} ${esc(w.direction)} · ${gustText}</div><div class="wind-compare-grid">${windCompare('10분 전 관측',w.previous10m,w)}${windCompare('1시간 전 실황',w.previous1h,w)}${windCompare('1시간 후 예보',w.forecast1h,w)}${windCompare('3시간 후 예보',w.forecast3h,w)}</div></article>`;
    }).join('');
  }

  function riverMetric(name,obj){
    const h=obj.history,cur=obj.waterLevelM,d10=historyDelta(h,1),d30=historyDelta(h,3),d60=historyDelta(h,6);
    return `<article class="metric river-metric"><div class="data-time">관측 ${fullDateTimeText(obj.observedAt)} · ${obj.intervalMinutes}분 간격</div><div class="metric-label">${name}</div><div class="metric-value">${fmt(cur,2)}m</div><div class="comparison-list"><div><span>10분 전 ${timeText(h[h.length-2].timestamp)}</span><b>${fmt(historyValue(h,1),2)}m</b><em class="${deltaClass(d10)}">${signed(d10,2,'m')}</em></div><div><span>30분 전 ${timeText(h[h.length-4].timestamp)}</span><b>${fmt(historyValue(h,3),2)}m</b><em class="${deltaClass(d30)}">${signed(d30,2,'m')}</em></div><div><span>1시간 전 ${timeText(h[h.length-7].timestamp)}</span><b>${fmt(historyValue(h,6),2)}m</b><em class="${deltaClass(d60)}">${signed(d60,2,'m')}</em></div></div></article>`;
  }
  function renderRiver(){$('riverGrid').innerHTML=riverMetric('잠수교 수위',data.hydrology.jamsuBridge)+riverMetric('한강대교 수위',data.hydrology.hangangBridge)}

  function tideEventCard(label,event,compareEvent,referenceAt){
    const diff=compareEvent?event.heightCm-compareEvent.heightCm:null;
    return `<div class="metric"><div class="data-time">자료 갱신 ${dateTimeText(data.tide.updatedAt)}</div><div class="metric-label">${label}</div><div class="metric-value">${timeText(event.time)}</div><div class="metric-sub">${dateTimeText(event.time)} · ${fmt(event.heightCm)}cm${diff===null?'':` · 이전 대비 ${signed(diff,0,'cm')}`}</div><div class="event-countdown">기준시각부터 ${durationText(referenceAt,event.time)}</div></div>`;
  }
  function renderTide(){
    const t=data.tide;
    $('tideGrid').innerHTML=tideEventCard('다음 만조',t.nextHigh,t.previousHigh,t.referenceAt)+tideEventCard('다음 간조',t.nextLow,t.previousLow,t.referenceAt)+`<div class="metric"><div class="data-time">판단 기준 ${dateTimeText(t.referenceAt)}</div><div class="metric-label">조석 구분</div><div class="metric-value">${esc(t.phase)}</div><div class="metric-sub">이전 만조 ${timeText(t.previousHigh.time)} ${fmt(t.previousHigh.heightCm)}cm<br>다음날 만조 ${dateTimeText(t.nextAfterHigh.time)} ${fmt(t.nextAfterHigh.heightCm)}cm</div></div><div class="metric"><div class="data-time">판단 기준 ${dateTimeText(t.referenceAt)}</div><div class="metric-label">방류 중첩위험</div><div class="metric-value ${t.overlapRisk!=='낮음'?'warn':''}">${esc(t.overlapRisk)}</div><div class="metric-sub">다음 만조 ${timeText(t.nextHigh.time)} · 서부선 판단 참고</div></div>`;
    $('tideComparisonBody').innerHTML=`<tr><td>이전 간조</td><td>${dateTimeText(t.previousLow.time)}</td><td>${fmt(t.previousLow.heightCm)}cm</td><td>관측·예측</td></tr><tr><td>이전 만조</td><td>${dateTimeText(t.previousHigh.time)}</td><td>${fmt(t.previousHigh.heightCm)}cm</td><td>관측·예측</td></tr><tr class="current-row"><td>기준시각</td><td>${dateTimeText(t.referenceAt)}</td><td>-</td><td>${esc(t.phase)}</td></tr><tr><td>다음 만조</td><td>${dateTimeText(t.nextHigh.time)}</td><td>${fmt(t.nextHigh.heightCm)}cm</td><td>이전 대비 ${signed(t.nextHigh.heightCm-t.previousHigh.heightCm,0,'cm')}</td></tr><tr><td>다음 간조</td><td>${dateTimeText(t.nextLow.time)}</td><td>${fmt(t.nextLow.heightCm)}cm</td><td>이전 대비 ${signed(t.nextLow.heightCm-t.previousLow.heightCm,0,'cm')}</td></tr>`;
  }

  function renderHealth(){
    const items=data.health||[];
    $('healthGrid').innerHTML=items.map(x=>`<div class="health-card"><span>${esc(x.name)}</span><b class="good">${x.status==='normal'?'정상':'확인'}</b><em>${dateTimeText(x.updatedAt)} · ${x.intervalMinutes}분 주기</em></div>`).join('');
  }

  function lineChart(svg,history,opt){
    const W=600,H=190,p=30,min=opt.min,max=opt.max;
    const x=i=>p+i*(W-2*p)/(history.length-1),y=v=>H-p-(v-min)*(H-2*p)/(max-min);
    const grid=[min,(min+max)/2,max].map(v=>`<line class="chart-grid" x1="${p}" x2="${W-p}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis" x="2" y="${y(v)+3}">${v.toFixed(2)}</text>`).join('');
    const refs=opt.lines.map(l=>`<line x1="${p}" x2="${W-p}" y1="${y(l.v)}" y2="${y(l.v)}" stroke="${l.color}" stroke-width="2" stroke-dasharray="7 6"/>`).join('');
    const pts=history.map((v,i)=>`${x(i)},${y(v[opt.key])}`).join(' ');
    const labels=history.map((v,i)=>i%2===0||i===history.length-1?`<text class="chart-axis" text-anchor="middle" x="${x(i)}" y="${H-8}">${esc(v.time)}</text>`:'').join('');
    const dots=history.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v[opt.key])}" r="${i===history.length-1?4:2}" fill="${opt.color}"/>`).join('');
    svg.innerHTML=`${grid}${refs}<polyline class="chart-line" stroke="${opt.color}" points="${pts}"/>${dots}${labels}`;
  }
  function damChart(svg,h){
    const W=800,H=220,p=40,max=Math.max(3300,...h.flatMap(v=>[v.inflow,v.outflow])),min=0,x=i=>p+i*(W-2*p)/(h.length-1),y=v=>H-p-(v-min)*(H-2*p)/(max-min);
    const grid=[0,1000,2000,3000].map(v=>`<line class="chart-grid" x1="${p}" x2="${W-p}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis" x="2" y="${y(v)+3}">${v}</text>`).join('');
    const ref=`<line x1="${p}" x2="${W-p}" y1="${y(2000)}" y2="${y(2000)}" stroke="#f1c75b" stroke-width="2" stroke-dasharray="8 6"/><line x1="${p}" x2="${W-p}" y1="${y(3000)}" y2="${y(3000)}" stroke="#ef646b" stroke-width="2" stroke-dasharray="8 6"/>`;
    const inflow=h.map((v,i)=>`${x(i)},${y(v.inflow)}`).join(' '),outflow=h.map((v,i)=>`${x(i)},${y(v.outflow)}`).join(' ');
    const labels=h.map((v,i)=>i%2===0||i===h.length-1?`<text class="chart-axis" text-anchor="middle" x="${x(i)}" y="${H-9}">${v.time}</text>`:'').join('');
    const dots=h.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v.inflow)}" r="${i===h.length-1?4:2}" fill="#f29a52"/><circle cx="${x(i)}" cy="${y(v.outflow)}" r="${i===h.length-1?4:2}" fill="#55b7ec"/>`).join('');
    svg.innerHTML=`${grid}${ref}<polyline class="chart-line" stroke="#f29a52" points="${inflow}"/><polyline class="chart-line" stroke="#55b7ec" points="${outflow}"/>${dots}${labels}`;
  }


  function openWeatherSettings(){
    const s=window.KMA?.getSettings?.()||{};
    $('kmaAuthKeyInput').value=s.authKey||'';
    $('weatherTestResult').className='settings-result';
    $('weatherTestResult').textContent='인증키를 입력한 뒤 연결 테스트를 실행하십시오.';
    $('weatherModal').hidden=false;
    document.body.classList.add('modal-open');
  }
  function closeWeatherSettings(){
    $('weatherModal').hidden=true;
    document.body.classList.remove('modal-open');
  }
  async function testWeatherSettings(){
    const key=$('kmaAuthKeyInput').value.trim(),result=$('weatherTestResult');
    if(!key){result.className='settings-result error';result.textContent='기상청 인증키를 입력하십시오.';return;}
    result.className='settings-result loading';result.textContent='기상청 초단기실황·특보사항 연결 확인 중...';
    try{
      const test=await window.KMA.testConnection(key);
      result.className='settings-result success';
      result.textContent=`연결 성공 · ${timeText(test.observedAt)} ${test.direction} ${fmt(test.speed,1)}m/s · 1시간 강수 ${fmt(test.rain1h,1)}mm · 특보 ${test.alertCount}건`;
    }catch(err){
      result.className='settings-result error';result.textContent=`연결 실패: ${err.message}`;
    }
  }
  function bindWeatherSettings(){
    $('weatherSettingsBtn')?.addEventListener('click',openWeatherSettings);
    document.querySelectorAll('[data-close-weather]').forEach(x=>x.addEventListener('click',closeWeatherSettings));
    $('showKmaKey')?.addEventListener('change',e=>{$('kmaAuthKeyInput').type=e.target.checked?'text':'password';});
    $('testWeatherBtn')?.addEventListener('click',testWeatherSettings);
    $('saveWeatherBtn')?.addEventListener('click',async()=>{
      const authKey=$('kmaAuthKeyInput').value.trim();
      if(!authKey){$('weatherTestResult').className='settings-result error';$('weatherTestResult').textContent='기상청 인증키를 입력하십시오.';return;}
      window.KMA.saveSettings({authKey});closeWeatherSettings();await loadData();
    });
    $('clearWeatherBtn')?.addEventListener('click',()=>{
      window.KMA.clearSettings();$('kmaAuthKeyInput').value='';
      $('weatherTestResult').className='settings-result';$('weatherTestResult').textContent='저장값을 삭제했습니다.';
    });
  }

  function openHydrologySettings(){
    const s=window.HRFCO?.getSettings?.()||{};
    $('paldangUrlInput').value=s.paldangUrl||'';
    $('jamsuUrlInput').value=s.jamsuUrl||'';
    $('hangangUrlInput').value=s.hangangUrl||'';
    $('hydrologyTestResult').className='settings-result';
    $('hydrologyTestResult').textContent='URL을 입력한 뒤 테스트하십시오.';
    $('hydrologyModal').hidden=false;
    document.body.classList.add('modal-open');
  }
  function closeHydrologySettings(){
    $('hydrologyModal').hidden=true;
    document.body.classList.remove('modal-open');
  }
  function hydrologyFormValues(){
    return {
      paldangUrl:$('paldangUrlInput').value.trim(),
      jamsuUrl:$('jamsuUrlInput').value.trim(),
      hangangUrl:$('hangangUrlInput').value.trim()
    };
  }
  async function testHydrologySettings(){
    const v=hydrologyFormValues(), result=$('hydrologyTestResult');
    if(!v.paldangUrl||!v.jamsuUrl||!v.hangangUrl){
      result.className='settings-result error';result.textContent='URL 3개를 모두 입력하십시오.';return;
    }
    result.className='settings-result loading';result.textContent='팔당댐·잠수교·한강대교 연결 확인 중...';
    try{
      const [p,j,h]=await Promise.all([
        window.HRFCO.testUrl('paldang',v.paldangUrl),
        window.HRFCO.testUrl('jamsu',v.jamsuUrl),
        window.HRFCO.testUrl('hangang',v.hangangUrl)
      ]);
      result.className='settings-result success';
      result.textContent=`연결 성공 · 팔당 ${fmt(p.outflowCms,1)}㎥/s · 잠수교 ${fmt(j.waterLevelM,2)}m · 한강대교 ${fmt(h.waterLevelM,2)}m`;
    }catch(err){
      result.className='settings-result error';result.textContent=`연결 실패: ${err.message}`;
    }
  }
  function bindHydrologySettings(){
    $('hydrologySettingsBtn')?.addEventListener('click',openHydrologySettings);
    document.querySelectorAll('[data-close-settings]').forEach(x=>x.addEventListener('click',closeHydrologySettings));
    $('showHrfcoUrls')?.addEventListener('change',e=>{
      ['paldangUrlInput','jamsuUrlInput','hangangUrlInput'].forEach(id=>$(id).type=e.target.checked?'text':'password');
    });
    $('testHydrologyBtn')?.addEventListener('click',testHydrologySettings);
    $('saveHydrologyBtn')?.addEventListener('click',async()=>{
      const v=hydrologyFormValues();
      if(!v.paldangUrl||!v.jamsuUrl||!v.hangangUrl){$('hydrologyTestResult').className='settings-result error';$('hydrologyTestResult').textContent='URL 3개를 모두 입력하십시오.';return;}
      window.HRFCO.saveSettings(v);closeHydrologySettings();await loadData();
    });
    $('clearHydrologyBtn')?.addEventListener('click',()=>{
      window.HRFCO.clearSettings();
      ['paldangUrlInput','jamsuUrlInput','hangangUrlInput'].forEach(id=>$(id).value='');
      $('hydrologyTestResult').className='settings-result';$('hydrologyTestResult').textContent='저장값을 삭제했습니다.';
    });
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-scenario]');if(!b)return;scenario=b.dataset.scenario;loadData();});
  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));}
  bindWeatherSettings();
  bindHydrologySettings();
  loadData();
  setInterval(()=>{if(cfg.DATA_MODE==='live'||cfg.DATA_MODE==='hybrid')loadData()},cfg.REFRESH_MS);
})();
