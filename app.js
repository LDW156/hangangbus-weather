(() => {
  'use strict';
  const cfg = window.HANGANG_CONFIG;
  let data = null;
  let scenario = 'normal';
  let isLoading = false;
  let lastRefreshStartedAt = null;
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
  const historyPoint = (history, steps=0) => history[Math.max(0, history.length-1-steps)] || history[0] || {};
  const ageMinutes = (v) => { const d=toDate(v); return d?Math.max(0,Math.round((Date.now()-d.getTime())/60000)):null; };
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

  async function loadData(trigger='auto'){
    if(isLoading) return;
    isLoading=true;
    lastRefreshStartedAt=new Date();
    setRefreshState('loading');

    // 갱신 실패나 미확정 응답이 발생해도 직전 정상 실데이터를 보존합니다.
    const previousData=data?structuredClone(data):null;
    data=structuredClone(window.HANGANG_DEMO_DATA[scenario]);

    const liveSources=[];
    const setupSources=[];
    const errors=[];
    const notes=[];

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
          if(live.warnings?.length){
            notes.push(...live.warnings.map(x=>`수문 참고: ${x}`));
          }
          liveSources.push('수문');
        }catch(err){
          if(previousData?.hydrology){
            data.hydrology=previousData.hydrology;
            data.meta.dataTimes.hydrology=previousData.meta?.dataTimes?.hydrology;
            data.health=(data.health||[]).filter(x=>!['한강수위','팔당댐'].includes(x.name));
            const previousHealth=(previousData.health||[]).filter(x=>['한강수위','팔당댐'].includes(x.name));
            data.health.unshift(...previousHealth);
            notes.push(`수문 갱신 실패 · 직전 정상값 유지 (${err.message})`);
            liveSources.push('수문(직전값)');
          }else{
            errors.push(`수문: ${err.message}`);
          }
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
          data.alertStatus = live.alertStatus;
          data.meta.dataTimes.weatherObservation = live.observedAt;
          data.meta.dataTimes.weatherForecastIssued = live.forecastIssuedAt;
          data.health = (data.health || []).filter(x => !['기상관측','기상예보','기상특보'].includes(x.name));
          data.health.push(
            {name:'기상관측',status:'normal',updatedAt:live.observedAt,intervalMinutes:60},
            {name:'기상예보',status:'normal',updatedAt:live.forecastIssuedAt,intervalMinutes:60},
            {name:'기상특보',status:'normal',updatedAt:live.fetchedAt,intervalMinutes:10}
          );
          if(live.warnings?.length) notes.push(...live.warnings.map(x=>`기상 참고: ${x}`));
          liveSources.push('기상');
        }catch(err){
          if(previousData?.weather){
            data.weather=previousData.weather;
            data.alerts=previousData.alerts||[];
            data.alertStatus=previousData.alertStatus;
            data.meta.dataTimes.weatherObservation=previousData.meta?.dataTimes?.weatherObservation;
            data.meta.dataTimes.weatherForecastIssued=previousData.meta?.dataTimes?.weatherForecastIssued;
            data.health=(data.health||[]).filter(x=>!['기상관측','기상예보','기상특보'].includes(x.name));
            const previousHealth=(previousData.health||[]).filter(x=>['기상관측','기상예보','기상특보'].includes(x.name));
            data.health.push(...previousHealth);
            notes.push(`기상 갱신 실패 · 직전 정상값 유지 (${err.message})`);
            liveSources.push('기상(직전값)');
          }else{
            errors.push(`기상: ${err.message}`);
          }
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
      else if(notes.length) setBanner('live',`${liveText} / ${demoText} / ${notes.join(' | ')}`);
      else setBanner('live',`${liveText} / ${demoText}. 각 카드의 관측·예보 시각을 확인하십시오.`);
    }else if(errors.length){
      $('modeBadge').textContent='ERROR';
      setBanner('error',`${errors.join(' | ')} · 현재 표시값은 데모이므로 운항판단에 사용하지 마십시오.`);
    }else{
      $('modeBadge').textContent=setupSources.length?'SETUP':'DEMO';
      setBanner('demo',`${setupSources.join('·')} 실데이터 설정 전입니다. GitHub 공용 설정파일을 확인하십시오. 조석은 데모 데이터입니다.`);
    }

    render();
    isLoading=false;
    setRefreshState(errors.length?'warning':'done');
  }

  function setRefreshState(state){
    const btn=$('refreshBtn'), note=$('refreshNote');
    if(!btn||!note)return;
    btn.disabled=state==='loading';
    btn.classList.toggle('loading',state==='loading');
    btn.innerHTML=state==='loading'?'<span class="refresh-icon">↻</span> 불러오는 중':'<span class="refresh-icon">↻</span> 최신 데이터 업데이트';
    if(state==='loading') note.textContent='수문·기상 최신자료 조회 중';
    else if(state==='warning') note.textContent=`갱신 완료 · 일부 참고자료 확인 필요 · ${timeText(new Date())}`;
    else note.textContent=`갱신 완료 ${timeText(new Date())} · 자동 5분`;
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
      const values=arr
        .map(x=>x[key])
        .filter(v=>v!==null&&v!==undefined&&v!=='')
        .map(Number)
        .filter(Number.isFinite);
      return values.length?Math.max(...values):null;
    };

    const windStats=(arr)=>({
      speed:max(arr,'speed')??0
    });

    const eastStats=windStats(eastW);
    const westStats=windStats(westW);
    const reason=(text,state='normal',badge='정상')=>({text,state,badge});
    const severity={danger:0,warning:1,normal:2,info:3};
    const sortReasons=arr=>arr.sort((a,b)=>(severity[a.state]??9)-(severity[b.state]??9));

    let jamsu='normal';
    if(wl>=t.jamsu.stopLevelM || clearance<=t.jamsu.stopClearanceM) jamsu='stop';
    else if(wl>=t.jamsu.cautionLevelM || clearance<=t.jamsu.cautionClearanceM) jamsu='caution';

    let east='normal';
    let west='normal';
    const eastReasons=[];
    const westReasons=[];

    if(jamsu==='stop'){
      east='stop';
      eastReasons.push(reason(
        `잠수교 통과높이 ${fmt(clearance,2)}m ≤ 운항중지 기준 ${fmt(t.jamsu.stopClearanceM,2)}m`,
        'danger','운항중지'
      ));
    }else if(jamsu==='caution'){
      east='caution';
      eastReasons.push(reason(
        `잠수교 통과높이 ${fmt(clearance,2)}m · 주의 기준 ${fmt(t.jamsu.cautionClearanceM,2)}m 이하`,
        'warning','주의'
      ));
    }else{
      eastReasons.push(reason(
        `잠수교 통과높이 ${fmt(clearance,2)}m · 운항중지 기준보다 ${fmt(clearance-t.jamsu.stopClearanceM,2)}m 여유`,
        'normal','정상'
      ));
    }

    if(out>=t.paldang.eastStopCms && rising){
      east='stop';
      eastReasons.push(reason(
        `팔당댐 방류량 ${fmt(out)}㎥/s · ${fmt(t.paldang.eastStopCms)}㎥/s 이상이며 증가 추세`,
        'danger','운항중지'
      ));
    }else if(out>=t.paldang.eastCautionCms){
      if(east==='normal')east='caution';
      eastReasons.push(reason(
        `팔당댐 방류량 ${fmt(out)}㎥/s · 동부선 기준 접근`,
        'warning','주의'
      ));
    }else{
      eastReasons.push(reason(
        `팔당댐 방류량 ${fmt(out)}㎥/s · 동부선 기준 미만`,
        'normal','정상'
      ));
    }

    if(out>=t.paldang.westStopCms){
      west='stop';
      westReasons.push(reason(
        `팔당댐 방류량 ${fmt(out)}㎥/s ≥ 서부선 운항중지 기준 ${fmt(t.paldang.westStopCms)}㎥/s`,
        'danger','운항중지'
      ));
    }else if(out>=t.paldang.westCautionCms){
      west='caution';
      westReasons.push(reason(
        `팔당댐 방류량 ${fmt(out)}㎥/s · 서부선 기준 접근`,
        'warning','주의'
      ));
    }else{
      westReasons.push(reason(
        `팔당댐 방류량 ${fmt(out)}㎥/s · 서부선 기준 미만`,
        'normal','정상'
      ));
    }

    const evaluateWind=(routeName,stats,stations,reasons,currentStatus)=>{
      const stop=stats.speed>=t.wind.stopMs;
      const caution=stats.speed>=t.wind.cautionMs;
      const observationTime=timeText(stations[0]?.observedAt);

      if(stop){
        reasons.push(reason(
          `${routeName} 최대 평균풍속 ${fmt(stats.speed,1)}m/s ≥ 운항중지 기준 ${fmt(t.wind.stopMs,1)}m/s`,
          'danger','운항중지'
        ));
        return 'stop';
      }

      if(caution){
        reasons.push(reason(
          `${routeName} 최대 평균풍속 ${fmt(stats.speed,1)}m/s · 주의 기준 ${fmt(t.wind.cautionMs,1)}m/s 이상 · ${observationTime}`,
          'warning','주의'
        ));
        return currentStatus==='normal'?'caution':currentStatus;
      }

      reasons.push(reason(
        `${routeName} 최대 평균풍속 ${fmt(stats.speed,1)}m/s · ${observationTime}`,
        'normal','정상'
      ));
      return currentStatus;
    };

    east=evaluateWind('동부선',eastStats,eastW,eastReasons,east);
    west=evaluateWind('서부선',westStats,westW,westReasons,west);

    const rainThreshold=t.rainfall||{};
    const stop3h=Number(rainThreshold.stop3hMm??90);
    const stop12h=Number(rainThreshold.stop12hMm??180);

    const evaluateRain=(routeName,r,reasons,currentStatus)=>{
      if(!r){
        reasons.push(reason(`${routeName} 강수자료 없음`,'warning','확인'));
        return currentStatus==='normal'?'caution':currentStatus;
      }

      const by3=Number(r.next3h)>=stop3h;
      const by12=Number(r.next12h)>=stop12h;

      if(by3||by12){
        const triggered=[
          by3?`3시간 ${fmt(r.next3h,1)}mm ≥ ${fmt(stop3h)}mm`:null,
          by12?`12시간 ${fmt(r.next12h,1)}mm ≥ ${fmt(stop12h)}mm`:null
        ].filter(Boolean).join(' · ');

        reasons.push(reason(
          `호우 운항중지 기준 충족 · ${triggered}`,
          'danger','운항중지'
        ));
        return 'stop';
      }

      reasons.push(reason(
        `예상강수 3시간 ${fmt(r.next3h,1)}mm / 12시간 ${fmt(r.next12h,1)}mm · 강수확률 최대 ${fmt(Math.max(r.next3hProbability||0,r.next12hProbability||0))}%`,
        'normal','정상'
      ));
      return currentStatus;
    };

    const eastRain=data.weather.rainfall?.east;
    const westRain=data.weather.rainfall?.west;
    east=evaluateRain('동부선',eastRain,eastReasons,east);
    west=evaluateRain('서부선',westRain,westReasons,west);

    const alertKeywords=t.alerts?.stopKeywords||[
      '호우경보','강풍주의보','강풍경보','태풍주의보','태풍경보'
    ];
    const officialAlerts=data.alerts.filter(a=>a.source==='official');
    const preliminaryAlerts=data.alerts.filter(a=>a.source==='preliminary');
    const stopAlerts=officialAlerts.filter(a=>{
      const text=`${a.title||''} ${a.message||''}`.replace(/\s+/g,'');
      return alertKeywords.some(keyword=>text.includes(String(keyword).replace(/\s+/g,'')));
    });

    if(stopAlerts.length){
      const names=[...new Set(stopAlerts.map(a=>a.title).filter(Boolean))].join(' · ');
      east='stop';
      west='stop';
      const alertReason=reason(
        `기상특보 운항중지 대상 발효 · ${names||'호우경보·강풍/태풍 주의보 이상'}`,
        'danger','특보중지'
      );
      eastReasons.push(alertReason);
      westReasons.push({...alertReason});
    }else if(officialAlerts.length){
      const names=[...new Set(officialAlerts.map(a=>a.title).filter(Boolean))].join(' · ');
      if(east==='normal')east='caution';
      if(west==='normal')west='caution';
      eastReasons.push(reason(`기상특보 발표 중 · ${names}`,'warning','특보확인'));
      westReasons.push(reason(`기상특보 발표 중 · ${names}`,'warning','특보확인'));
    }else if(preliminaryAlerts.length){
      if(east==='normal')east='caution';
      if(west==='normal')west='caution';
      const names=[...new Set(preliminaryAlerts.map(a=>a.title).filter(Boolean))].join(' · ');
      eastReasons.push(reason(`예비특보 발표 · ${names}`,'warning','사전검토'));
      westReasons.push(reason(`예비특보 발표 · ${names}`,'warning','사전검토'));
    }else{
      eastReasons.push(reason('운항중지 대상 기상특보 없음','normal','정상'));
      westReasons.push(reason('운항중지 대상 기상특보 없음','normal','정상'));
    }

    westReasons.push(reason(
      `조석 ${timeText(data.tide.referenceAt)} · ${data.tide.phase}, 중첩위험 ${data.tide.overlapRisk}`,
      data.tide.overlapRisk==='높음'?'warning':'info',
      data.tide.overlapRisk==='높음'?'주의':'참고'
    ));

    return {
      jamsu,clearance,east,west,
      eastReasons:sortReasons(eastReasons),
      westReasons:sortReasons(westReasons),
      rising
    };
  }

  function render(){
    const calc=compute();
    renderRoutes(calc);renderJamsu(calc);renderDam(calc);renderAlerts();renderRain();renderWind();renderRiver();renderTide();renderHealth();
    $('updatedAt').textContent=`화면 갱신 ${dateTimeText(data.meta.generatedAt)}`;
  }

  function routeCard(name,status,reasons,basis){
    const reasonHtml=reasons.map(r=>{
      const item=typeof r==='string'?{text:r,state:'info',badge:'참고'}:r;
      return `<li class="route-reason ${esc(item.state||'info')}">
        <span class="reason-badge">${esc(item.badge||'참고')}</span>
        <span class="reason-text">${esc(item.text)}</span>
      </li>`;
    }).join('');

    return `<div class="route-card-time">판단 산출 ${dateTimeText(data.meta.generatedAt)} · ${esc(basis)}</div>
      <div class="route-name">${esc(name)}</div>
      <div class="route-status">${statusText[status]}</div>
      <ul class="route-reasons">${reasonHtml}</ul>`;
  }

  function renderRoutes(c){
    const eastBasis=`자료기준 잠수교 ${timeText(data.hydrology.jamsuBridge.observedAt)} · 팔당 ${timeText(data.hydrology.paldang.observedAt)} · 기상 ${timeText(data.meta.dataTimes.weatherObservation)}`;
    const westBasis=`자료기준 팔당 ${timeText(data.hydrology.paldang.observedAt)} · 기상 ${timeText(data.meta.dataTimes.weatherObservation)} · 조석 ${timeText(data.tide.referenceAt)}`;
    $('eastRoute').className=`route-card ${c.east}`;$('eastRoute').innerHTML=routeCard('동부선',c.east,c.eastReasons,eastBasis);
    $('westRoute').className=`route-card ${c.west}`;$('westRoute').innerHTML=routeCard('서부선',c.west,c.westReasons,westBasis);
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
        ${comparisonCell('10분 전',timeText(historyPoint(h,1).timestamp),cur,historyValue(h,1),2,'m')}
        ${comparisonCell('30분 전',timeText(historyPoint(h,3).timestamp),cur,historyValue(h,3),2,'m')}
        ${comparisonCell('1시간 전',timeText(historyPoint(h,6).timestamp),cur,historyValue(h,6),2,'m')}
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

    if(!data.alerts.length){
      const status=data.alertStatus||{};
      const area=status.area||'서울특별시·수도권';
      const issuedAt=data.meta.dataTimes.weatherForecastIssued||data.meta.generatedAt;

      root.innerHTML=`
        <article class="alert-card clear">
          <div class="alert-top">
            <div>
              <div class="alert-tags">
                <span class="tag">기상청 공식</span>
                <span class="tag">${esc(area)}</span>
              </div>
              <h3>${esc(status.warning||'현재 발효 특보 없음')}</h3>
            </div>
            <span class="alert-time">확인 ${dateTimeText(issuedAt)}</span>
          </div>
          <p>${esc(status.preliminary||'현재 예비특보 없음')} · ${esc(status.message||'특보 안내문은 실제 특보로 계산하지 않습니다.')}</p>
          <div class="alert-period">
            <span>조회 기준 ${fullDateTimeText(data.meta.generatedAt)}</span>
            <b>현재 발표된 구체적인 주의보·경보 없음</b>
          </div>
        </article>`;
      return;
    }

    root.innerHTML=data.alerts.map(a=>{
      const effective=a.effectiveAt
        ? `<b>발효·예상 ${fullDateTimeText(a.effectiveAt)}</b>`
        : `<b>기상청 발표 원문 기준</b>`;

      return `<article class="alert-card ${esc(a.source==='internal'?'internal':a.level)}">
        <div class="alert-top">
          <div>
            <div class="alert-tags">
              <span class="tag ${a.source==='internal'?'internal':''}">${a.source==='official'?'기상청 공식':a.source==='preliminary'?'기상청 예비':'한강버스 내부'}</span>
              <span class="tag">${esc(a.area)}</span>
            </div>
            <h3>${esc(a.title)}</h3>
          </div>
          <span class="alert-time">발표 ${dateTimeText(a.issuedAt)}</span>
        </div>
        <p>${esc(a.message)}</p>
        <div class="alert-period">
          <span>발표 ${fullDateTimeText(a.issuedAt)}</span>
          ${effective}
        </div>
      </article>`;
    }).join('');
  }

  function compactRainSource(value){
    const names=String(value||'-')
      .split('·')
      .map(x=>x.trim())
      .filter(Boolean);

    if(!names.length)return '-';
    if(names.length===1)return names[0];

    // 여러 선착장이 같은 기상청 격자를 공유하는 경우 카드 안에서는 짧게 표시합니다.
    return `${names[0]}권역`;
  }

  function rainVisual(row){
    const amount=Number(row?.amount)||0;
    const probability=Number(row?.probability)||0;
    const pty=Number(row?.pty)||0;
    const sky=Number(row?.sky)||1;

    if([1,4,5].includes(pty)||amount>0){
      return {icon:'🌧️',label:'비',className:'rain-now'};
    }

    if([2,6].includes(pty)){
      return {icon:'🌨️',label:'비·눈',className:'rain-now'};
    }

    if([3,7].includes(pty)){
      return {icon:'❄️',label:'눈',className:'rain-now'};
    }

    if(probability>=60){
      return {icon:'☔',label:'비 가능성 높음',className:'prob-high'};
    }

    if(probability>=30){
      return {icon:'🌦️',label:'비 가능성 있음',className:'prob-mid'};
    }

    if(probability>=20){
      return {icon:'🌂',label:'비 가능성 낮음',className:'prob-low'};
    }

    if(sky===4){
      return {icon:'☁️',label:'흐림',className:'prob-none'};
    }

    if(sky===3){
      return {icon:'🌥️',label:'구름 많음',className:'prob-none'};
    }

    return {icon:'☀️',label:'강수 가능성 낮음',className:'prob-none'};
  }

  function renderRain(){
    const names={west:'서부선',east:'동부선'};

    $('rainCards').innerHTML=['west','east'].map(k=>{
      const r=data.weather.rainfall[k];

      const summaries=[
        ['향후 3시간',r.next3h,r.next3hProbability],
        ['향후 6시간',r.next6h,r.next6hProbability],
        ['향후 12시간',r.next12h,r.next12hProbability],
        ['향후 24시간',r.next24h,r.next24hProbability]
      ];

      const rows=(r.timeline||[]).map(x=>{
        const visual=rainVisual(x);
        const source=compactRainSource(x.source);

        return `<div class="rain-hour-card ${visual.className}">
          <div class="rain-hour-top">
            <div class="rain-hour-time">${esc(x.label)}</div>
            <div class="rain-weather-icon" aria-label="${esc(visual.label)}">${visual.icon}</div>
          </div>
          <div class="rain-weather-label">${esc(visual.label)}</div>
          <div class="rain-hour-amount">${fmt(x.amount,1)}<small>mm</small></div>
          <div class="rain-hour-probability">
            <span>강수확률</span>
            <b>${fmt(x.probability)}%</b>
          </div>
          <div class="rain-hour-source">최대값 기준 ${esc(source)}</div>
        </div>`;
      }).join('');

      const notice=!r.dataAvailable
        ? `<div class="rain-state missing"><b>강수자료 확인 필요</b><span>${esc(r.dryMessage)}</span></div>`
        : r.allDry
          ? `<div class="rain-state dry"><b>현재 강수 없음</b><span>시간별 강수확률과 하늘상태는 아래 카드에서 확인하십시오.</span></div>`
          : '';

      return `<article class="sector-card rain-card-v57">
        <div class="data-time">
          실황 ${dateTimeText(r.observedAt)} · 예보 발표 ${dateTimeText(r.forecastIssuedAt)} · 첫 예보 ${dateTimeText(r.forecastStartAt)}
        </div>

        <div class="sector-title rain-sector-title">
          <h3>${names[k]}</h3>
          <span>노선 내 최대 강수량·강수확률 기준</span>
        </div>

        <div class="rain-current-row">
          <div>
            <span>최근 1시간 실황</span>
            <b>${fmt(r.currentRate,1)}mm</b>
            <em>최대값 기준 ${esc(compactRainSource(r.currentSource))} · ${timeText(r.observedAt)}</em>
          </div>
          <div>
            <span>시간별 예보 시작</span>
            <b>${timeText(r.forecastStartAt)}</b>
            <em>강수량·강수확률·비 여부를 함께 표시</em>
          </div>
        </div>

        ${notice}

        <div class="rain-summary rain-summary-v57">
          ${summaries.map(x=>{
            const probability=Number(x[2])||0;
            const band=probability>=60?'high':probability>=30?'mid':probability>=20?'low':'none';

            return `<div class="rain-item probability-${band}">
              <span>${x[0]} 누적</span>
              <b>${fmt(x[1],1)}<small>mm</small></b>
              <em>강수확률 최대 <strong>${fmt(probability)}%</strong></em>
            </div>`;
          }).join('')}
        </div>

        <div class="rain-basis">
          <b>기상 기준좌표</b>
          <span>${esc(r.basisLabel)}</span>
        </div>

        <div class="rain-hour-scroll rain-hour-scroll-v57">
          ${rows||'<div class="empty-message">향후 시간별 강수예보 자료 없음</div>'}
        </div>
      </article>`;
    }).join('');
  }

  function windLevel(w){
    const t=cfg.THRESHOLDS.wind;
    if(w.speed>=t.stopMs)return'danger';
    if(w.speed>=t.cautionMs)return'warn';
    return'good';
  }
  function windColor(speed){
    const t=cfg.THRESHOLDS.wind;
    return speed>=t.stopMs?'#d43942':speed>=t.cautionMs?'#d28b11':'#16865a';
  }
  function compass(deg,speed,small=false){
    const d=Number.isFinite(Number(deg))?Number(deg):0;
    return `<div class="wind-compass ${small?'small':''}" style="--wind-deg:${d}deg;--wind-color:${windColor(Number(speed)||0)}">
      <span class="north">N</span><span class="east">E</span><span class="south">S</span><span class="west">W</span>
      <span class="wind-arrow"><i></i></span><span class="compass-center"></span>
    </div>`;
  }
  function forecastWindCard(x){
    if(!x)return `<div class="wind-forecast-card unavailable"><span>자료 없음</span></div>`;
    return `<div class="wind-forecast-card">
      <div class="wind-forecast-head"><span>${x.hour}시간 후</span><b>${timeText(x.time)}</b></div>
      <div class="wind-forecast-body">${compass(x.directionDeg,x.speed,true)}<div><strong>${fmt(x.speed,1)}m/s</strong><em>${esc(x.direction)}</em></div></div>
    </div>`;
  }
  function renderWind(){
    $('windGrid').innerHTML=data.weather.windStations.map(w=>{
      const coordinate=
        `${Number(w.lat).toFixed(5)}°N, ${Number(w.lon).toFixed(5)}°E`;

      return `<article class="station-card wind-card-v57">
        <div class="station-head">
          <div>
            <h3>${esc(w.name)}</h3>
            <div class="station-coordinate">기상 기준좌표 ${esc(coordinate)}</div>
          </div>
          <span class="sector-pill sector-pill-v57">${w.sector==='east'?'동부선':'서부선'}</span>
        </div>

        <div class="data-time wind-data-time">
          실황 ${dateTimeText(w.observedAt)} · 초단기예보 1시간 간격
        </div>

        <div class="wind-current-layout wind-current-layout-v57">
          <div class="wind-compass-column">
            ${compass(w.directionDeg,w.speed)}
            <strong>${esc(w.direction)}</strong>
            <small>${fmt(w.directionDeg)}°</small>
          </div>

          <div class="wind-reading wind-reading-v57">
            <span>현재 평균풍속</span>
            <b class="${windLevel(w)}">${fmt(w.speed,1)}<small>m/s</small></b>
            <em>${esc(w.direction)}에서 불어오는 바람</em>
          </div>
        </div>

        <div class="wind-direction-note">화살표 끝이 바람이 불어오는 방향입니다.</div>

        <div class="wind-forecast-grid-v57">
          ${[1,2].map(h=>forecastWindCard(w.forecasts?.find(x=>x.hour===h))).join('')}
        </div>
      </article>`;
    }).join('');
  }

  function riverMetric(name,obj){
    const h=obj.history,cur=obj.waterLevelM,d10=historyDelta(h,1),d30=historyDelta(h,3),d60=historyDelta(h,6);
    return `<article class="metric river-metric"><div class="data-time">관측 ${fullDateTimeText(obj.observedAt)} · ${obj.intervalMinutes}분 간격</div><div class="metric-label">${name}</div><div class="metric-value">${fmt(cur,2)}m</div><div class="comparison-list"><div><span>10분 전 ${timeText(historyPoint(h,1).timestamp)}</span><b>${fmt(historyValue(h,1),2)}m</b><em class="${deltaClass(d10)}">${signed(d10,2,'m')}</em></div><div><span>30분 전 ${timeText(historyPoint(h,3).timestamp)}</span><b>${fmt(historyValue(h,3),2)}m</b><em class="${deltaClass(d30)}">${signed(d30,2,'m')}</em></div><div><span>1시간 전 ${timeText(historyPoint(h,6).timestamp)}</span><b>${fmt(historyValue(h,6),2)}m</b><em class="${deltaClass(d60)}">${signed(d60,2,'m')}</em></div></div></article>`;
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
    const limits={한강수위:25,팔당댐:25,기상관측:110,기상예보:240,기상특보:30,조석:720};
    $('healthGrid').innerHTML=items.map(x=>{
      const age=ageMinutes(x.updatedAt), limit=limits[x.name]??Math.max(30,x.intervalMinutes*2);
      const stale=age===null||age>limit;
      return `<div class="health-card ${stale?'stale':''}"><span>${esc(x.name)}</span><b class="${stale?'bad':'good'}">${stale?'갱신 확인':'정상'}</b><em>${dateTimeText(x.updatedAt)} · ${age===null?'-':`${age}분 전`} · 기준 ${limit}분</em></div>`;
    }).join('');
  }


  function lineChart(svg,history,opt){
    const W=600,H=190,p=30,min=opt.min,max=opt.max;
    const x=i=>history.length<=1?W/2:p+i*(W-2*p)/(history.length-1),y=v=>H-p-(v-min)*(H-2*p)/(max-min);
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
  document.addEventListener('click',e=>{const b=e.target.closest('[data-scenario]');if(!b)return;scenario=b.dataset.scenario;loadData('scenario');});
  $('refreshBtn')?.addEventListener('click',()=>loadData('manual'));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&lastRefreshStartedAt&&Date.now()-lastRefreshStartedAt.getTime()>cfg.REFRESH_MS)loadData('resume');});
  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));}
  bindWeatherSettings();
  bindHydrologySettings();
  loadData('initial');
  setInterval(()=>{if(cfg.DATA_MODE==='live'||cfg.DATA_MODE==='hybrid')loadData('auto')},cfg.REFRESH_MS);
})();
