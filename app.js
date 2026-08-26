(() => {
  'use strict';
  const cfg = window.HANGANG_CONFIG;
  const sharedCache = window.HANGANG_DATA_CACHE || null;
  const AUTO_REFRESH_MS = sharedCache?.TTL_MS || 600000;
  let data = null;
  let scenario = 'normal';
  let isLoading = false;
  let lastRefreshStartedAt = null;
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d=0) => {
    const value=Number(n);
    if(!Number.isFinite(value))return '-';
    return value.toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d});
  };
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
  const dateOnlyText = (v) => {
    const d=toDate(v); if(!d || Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit',weekday:'short'});
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

  function tideIsUsable(tide){
    return Boolean(
      tide &&
      Array.isArray(tide.timeline) && tide.timeline.length >= 2 &&
      (tide.nextHigh || tide.nextLow || (Array.isArray(tide.events) && tide.events.length))
    );
  }

  function renderSharedSnapshot(snapshot){
    if(!snapshot?.data)return false;
    data=structuredClone(snapshot.data);
    lastRefreshStartedAt=snapshot.savedAt || new Date();
    updateTideOverlapRisk();
    render();
    if($('modeBadge'))$('modeBadge').textContent='CACHE';
    const age=Math.max(0,Math.round((Date.now()-new Date(snapshot.savedAt).getTime())/60000));
    setBanner('live',`공유 최신자료 사용 · ${age}분 전 갱신 · 자동 갱신주기 10분`);
    setRefreshState('cached');
    return true;
  }

  async function loadData(trigger='auto'){
    if(isLoading)return;
    const force=trigger==='manual';

    if(!force&&sharedCache){
      const fresh=sharedCache.readFresh();
      if(fresh){
        renderSharedSnapshot(fresh);
        return;
      }

      // 10분이 지난 자료라도 빈 화면보다 먼저 즉시 표시한 뒤 백그라운드 갱신합니다.
      const warm=sharedCache.readAny();
      if(warm)renderSharedSnapshot(warm);

      if(!sharedCache.acquireLock(false)){
        if(warm){
          // 다른 페이지가 갱신 중이면 현재 직전값을 유지하고 새 스냅샷을 기다립니다.
          setTimeout(()=>{
            const updated=sharedCache.readAny();
            if(updated&&updated.savedAt>warm.savedAt)renderSharedSnapshot(updated);
          },1800);
          return;
        }

        // 첫 방문인데 다른 탭이 갱신 중인 경우 잠시 결과를 기다립니다.
        const arrived=await sharedCache.waitForSnapshot?.(2500);
        if(arrived){
          renderSharedSnapshot(arrived);
          return;
        }

        // 캐시도 결과도 없으면 빈 화면 방지를 위해 이 페이지가 갱신권을 인계받습니다.
        sharedCache.acquireLock(true);
      }
    }else if(force&&sharedCache){
      sharedCache.acquireLock(true);
    }

    isLoading=true;
    lastRefreshStartedAt=new Date();
    setRefreshState('loading');

    const cachedPrevious=sharedCache?.readAny()?.data||null;
    const previousData=data?structuredClone(data):(cachedPrevious?structuredClone(cachedPrevious):null);
    // 갱신 중에도 직전 정상값을 화면에서 지우지 않습니다.
    data=previousData
      ? structuredClone(previousData)
      : structuredClone(window.HANGANG_DEMO_DATA[scenario]);
    data.health=(data.health||[]).filter(x=>!['한강수위','팔당댐','수문정보','기상관측','기상예보','기상특보','조석','조석정보'].includes(x.name));
    data.meta=data.meta||{};
    data.meta.dataTimes=data.meta.dataTimes||{};
    data.meta.generatedAt=new Date().toISOString();
    data.tide=previousData?.tide||{referenceAt:new Date().toISOString(),updatedAt:null,stationName:'인천',phase:'자료 확인',rangeClass:'자료 확인',rangeCm:null,overlapRisk:'자료 확인',currentObserved:null,currentPredicted:null,previousHigh:null,previousLow:null,nextHigh:null,nextLow:null,events:[],allEvents:[],timeline:[],monthly:{ok:false,daily:[],summary:null},monthlyError:null,sourceLabel:'조석자료 확인 중'};

    // 빈 화면을 기다리지 않도록 기본 화면을 즉시 먼저 표시합니다.
    updateTideOverlapRisk();
    render();
    if($('modeBadge'))$('modeBadge').textContent='LOADING';
    setBanner('loading','수문·기상·조석 최신 공식자료를 조회 중입니다.');

    const liveSources=[];
    const setupSources=[];
    const errors=[];
    const notes=[];
    const tasks=[];

    if(cfg.HRFCO?.ENABLED){
      if(window.HRFCO?.isConfigured()){
        tasks.push({
          type:'hydrology',
          promise:window.HRFCO.loadHydrology()
        });
      }else{
        setupSources.push('수문');
      }
    }

    if(cfg.KMA?.ENABLED){
      if(window.KMA?.isConfigured()){
        tasks.push({
          type:'weather',
          promise:window.KMA.loadWeather()
        });
      }else{
        setupSources.push('기상');
      }
    }

    if(cfg.OCEAN?.ENABLED){
      if(window.OCEAN?.isConfigured()){
        tasks.push({
          type:'tide',
          promise:window.OCEAN.loadTide({force:trigger==='manual'})
        });
      }else{
        setupSources.push('조석');
      }
    }

    const settled=await Promise.allSettled(
      tasks.map(task=>task.promise)
    );

    tasks.forEach((task,index)=>{
      const result=settled[index];

      if(result.status==='fulfilled'){
        const live=result.value;

        if(task.type==='hydrology'){
          data.hydrology={
            paldang:live.paldang,
            jamsuBridge:live.jamsuBridge,
            hangangBridge:live.hangangBridge
          };
          data.meta.dataTimes.hydrology=live.fetchedAt;
          data.health=(data.health||[]).filter(
            x=>!['한강수위','팔당댐','수문정보'].includes(x.name)
          );
          data.health.unshift(
            {name:'한강수위',status:'normal',updatedAt:live.jamsuBridge.observedAt,checkedAt:live.fetchedAt,intervalMinutes:10},
            {name:'팔당댐',status:'normal',updatedAt:live.paldang.observedAt,checkedAt:live.fetchedAt,intervalMinutes:10}
          );
          if(live.warnings?.length){
            notes.push(...live.warnings.map(x=>`수문 참고: ${x}`));
          }
          liveSources.push('수문');
        }

        if(task.type==='weather'){
          data.weather=live.weather;
          data.alerts=live.alerts;
          data.alertReleases=live.alertReleases||[];
          data.alertStatus=live.alertStatus;
          data.meta.dataTimes.weatherObservation=live.observedAt;
          data.meta.dataTimes.weatherForecastIssued=live.forecastIssuedAt;
          data.health=(data.health||[]).filter(
            x=>!['기상관측','기상예보','기상특보'].includes(x.name)
          );
          data.health.push(
            {name:'기상관측',status:'normal',updatedAt:live.observedAt,checkedAt:live.fetchedAt,intervalMinutes:60},
            {name:'기상예보',status:'normal',updatedAt:live.forecastIssuedAt,checkedAt:live.fetchedAt,intervalMinutes:60},
            {name:'기상특보',status:'normal',updatedAt:live.fetchedAt,checkedAt:live.fetchedAt,intervalMinutes:10}
          );
          if(live.warnings?.length){
            notes.push(...live.warnings.map(x=>`기상 참고: ${x}`));
          }
          liveSources.push('기상');
        }

        if(task.type==='tide'){
          data.health=(data.health||[]).filter(
            x=>!['조석','조석정보'].includes(x.name)
          );

          if(!tideIsUsable(live)){
            data.tide={referenceAt:new Date().toISOString(),updatedAt:null,stationName:'인천',phase:'자료 확인',rangeClass:'자료 확인',rangeCm:null,overlapRisk:'자료 확인',currentObserved:null,currentPredicted:null,previousHigh:null,previousLow:null,nextHigh:null,nextLow:null,events:[],allEvents:[],timeline:[],monthly:{ok:false,daily:[],summary:null},monthlyError:'조석 핵심자료 없음',sourceLabel:'조석자료 미수신'};
            data.health.push({name:'조석',status:'error',updatedAt:null,checkedAt:new Date().toISOString(),intervalMinutes:360,error:'조석 핵심자료 없음'});
            errors.push('조석: 예측조위 또는 만·간조 핵심자료 없음');
            return;
          }

          data.tide=live;
          data.meta.dataTimes.tide=live.updatedAt;
          const tideCacheStatus=String(live.cacheStatus||'');
          const tideStale=tideCacheStatus==='stale-cache';
          const tideStored=tideCacheStatus==='daily-cache';
          const tidePartial=live.monthly?.ok===false;
          data.health.push({
            name:'조석',status:tideStale?'cached':tideStored?'stored':tidePartial?'partial':'normal',updatedAt:live.updatedAt,
            checkedAt:new Date().toISOString(),intervalMinutes:360
          });
          if(tideStored)notes.push('조석: 당일 저장자료 사용');
          if(tideStale)notes.push('조석: 직전 정상자료 사용');
          if(live.predictionMode==='highlow-interpolation')notes.push('조석: 공식 만·간조 기반 보간곡선 사용');
          liveSources.push(tideStale?'조석(직전값)':tideStored?'조석(당일저장)':'조석');
        }

        return;
      }

      const err=result.reason instanceof Error
        ? result.reason
        : new Error(String(result.reason||'알 수 없는 오류'));

      if(task.type==='hydrology'&&previousData?.hydrology){
        data.hydrology=previousData.hydrology;
        data.meta.dataTimes.hydrology=previousData.meta?.dataTimes?.hydrology;
        data.health=(data.health||[]).filter(
          x=>!['한강수위','팔당댐','수문정보'].includes(x.name)
        );
        const previousHealth=(previousData.health||[])
          .filter(x=>['한강수위','팔당댐'].includes(x.name))
          .map(x=>({...x,status:'cached',lastAttemptAt:new Date().toISOString()}));
        data.health.unshift(...previousHealth);
        notes.push(`수문 갱신 실패 · 직전 정상값 유지 (${err.message})`);
        liveSources.push('수문(직전값)');
      }else if(task.type==='hydrology'){
        errors.push(`수문: ${err.message}`);
      }

      if(task.type==='weather'&&previousData?.weather){
        data.weather=previousData.weather;
        data.alerts=previousData.alerts||[];
        data.alertReleases=previousData.alertReleases||[];
        data.alertStatus=previousData.alertStatus;
        data.meta.dataTimes.weatherObservation=previousData.meta?.dataTimes?.weatherObservation;
        data.meta.dataTimes.weatherForecastIssued=previousData.meta?.dataTimes?.weatherForecastIssued;
        data.health=(data.health||[]).filter(
          x=>!['기상관측','기상예보','기상특보'].includes(x.name)
        );
        const previousHealth=(previousData.health||[])
          .filter(x=>['기상관측','기상예보','기상특보'].includes(x.name))
          .map(x=>({...x,status:'cached',lastAttemptAt:new Date().toISOString()}));
        data.health.push(...previousHealth);
        notes.push(`기상 갱신 실패 · 직전 정상값 유지 (${err.message})`);
        liveSources.push('기상(직전값)');
      }else if(task.type==='weather'){
        errors.push(`기상: ${err.message}`);
      }

      if(task.type==='tide'&&tideIsUsable(previousData?.tide)){
        data.tide=previousData.tide;
        data.meta.dataTimes.tide=previousData.meta?.dataTimes?.tide;
        data.health=(data.health||[]).filter(
          x=>!['조석','조석정보'].includes(x.name)
        );
        data.health.push({name:'조석',status:'cached',updatedAt:previousData.tide.updatedAt,checkedAt:new Date().toISOString(),intervalMinutes:360,lastAttemptAt:new Date().toISOString(),error:err.message});
        notes.push(`조석 갱신 실패 · 직전 정상값 유지 (${err.message})`);
        liveSources.push('조석(직전값)');
      }else if(task.type==='tide'){
        data.health=(data.health||[]).filter(
          x=>!['조석','조석정보'].includes(x.name)
        );
        data.tide={referenceAt:new Date().toISOString(),updatedAt:null,stationName:'인천',phase:'자료 확인',rangeClass:'자료 확인',rangeCm:null,overlapRisk:'자료 확인',currentObserved:null,currentPredicted:null,previousHigh:null,previousLow:null,nextHigh:null,nextLow:null,events:[],allEvents:[],timeline:[],monthly:{ok:false,daily:[],summary:null},monthlyError:err.message,sourceLabel:'조석자료 미수신'};
        data.health.push({name:'조석',status:'error',updatedAt:null,checkedAt:new Date().toISOString(),intervalMinutes:360,error:err.message});
        errors.push(`조석: ${err.message}`);
      }
    });

    updateTideOverlapRisk();
    data.meta.generatedAt=new Date().toISOString();
    data.meta.mode=liveSources.length?'live':'check';

    const hasSource=name=>liveSources.some(source=>source.startsWith(name));

    if(liveSources.length){
      if($('modeBadge'))$('modeBadge').textContent='LIVE';
      const liveText=`실데이터: ${liveSources.join('·')}`;
      const missingList=['수문','기상','조석'].filter(x=>!hasSource(x));
      const missingText=missingList.length?`자료 확인 필요: ${missingList.join('·')}`:'';
      const parts=[liveText,missingText].filter(Boolean);

      if(errors.length){
        setBanner('error',`${parts.join(' / ')} / 오류 ${errors.join(' | ')}`);
      }else if(notes.length){
        setBanner('live',`${parts.join(' / ')} / ${notes.join(' | ')}`);
      }else{
        setBanner('live',`${parts.join(' / ')}. 각 카드의 관측·예보 시각을 확인하십시오.`);
      }
    }else if(errors.length){
      if($('modeBadge'))$('modeBadge').textContent='ERROR';
      setBanner('error',`${errors.join(' | ')} · 현재 미수신 항목은 운항판단에 사용하지 마십시오.`);
    }else{
      if($('modeBadge'))$('modeBadge').textContent='CHECK';
      setBanner('loading',`${setupSources.join('·')} 자료 연결상태를 확인하고 있습니다.`);
    }

    render();
    sharedCache?.write(data,{trigger,errors,liveSources});
    sharedCache?.releaseLock();
    isLoading=false;
    setRefreshState(errors.length?'warning':'done');
}

  function setRefreshState(state){
    const btn=$('refreshBtn'), note=$('refreshNote');
    if(!btn||!note)return;
    btn.disabled=state==='loading';
    btn.classList.toggle('loading',state==='loading');
    btn.innerHTML=state==='loading'?'<span class="refresh-icon">↻</span> 불러오는 중':'<span class="refresh-icon">↻</span> 최신 데이터 업데이트';
    if(state==='loading') note.textContent='수문·기상·조석 최신자료 조회 중';
    else if(state==='cached') note.textContent='공유 최신자료 사용 · 자동 갱신 10분';
    else if(state==='warning') note.textContent=`갱신 완료 · 일부 참고자료 확인 필요 · ${timeText(new Date())}`;
    else note.textContent=`갱신 완료 ${timeText(new Date())} · 자동 10분`;
  }

  function setBanner(type,text){
    const safeType=type==='demo'?'loading':type;
    if(!$('systemBanner'))return;
    $('systemBanner').className=`system-banner ${safeType}`;
    $('systemBanner').textContent=text;
  }

  function updateTideOverlapRisk(){
    if(!data?.tide)return;
    const tide=data.tide;
    const outflow=Number(data.hydrology?.paldang?.outflowCms)||0;
    const nextHigh=tide.nextHigh?.time?new Date(tide.nextHigh.time):null;
    const minutesToHigh=nextHigh?Math.round((nextHigh-Date.now())/60000):null;
    const phase=tide.phase;

    let risk='낮음';
    if(minutesToHigh!==null&&minutesToHigh>=0&&minutesToHigh<=180&&outflow>=2000)risk='높음';
    else if((minutesToHigh!==null&&minutesToHigh>=0&&minutesToHigh<=300)||(phase==='창조'&&outflow>=1500))risk='보통';
    tide.overlapRisk=risk;
  }

  const IMPORTANT_OPERATION_ALERT_TYPES = [
    '호우',
    '강풍',
    '태풍'
  ];

  function isImportantOperationAlert(alert){
    const text=`${alert?.title||''} ${alert?.message||''}`;
    return IMPORTANT_OPERATION_ALERT_TYPES.some(
      type=>text.includes(type)
    );
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

    if(out>=t.paldang.eastStopCms){
      east='stop';
      eastReasons.push(reason(
        `팔당댐 방류량 ${fmt(out)}㎥/s · 동부선 운항중지 기준 ${fmt(t.paldang.eastStopCms)}㎥/s 이상`,
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
      const reliable3=r.next3hReliable!==false;
      const reliable12=r.next12hReliable!==false;

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

      if(!reliable3||!reliable12){
        reasons.push(reason(
          `강수량 일부 미제공 · 3시간 ${esc(r.next3hAmountDisplay||'-')}mm / 12시간 ${esc(r.next12hAmountDisplay||'-')}mm · 수동 확인 필요`,
          'warning','확인'
        ));
        return currentStatus==='normal'?'caution':currentStatus;
      }

      reasons.push(reason(
        `예상강수 3시간 ${esc(r.next3hAmountDisplay||fmt(r.next3h,1))}mm / 12시간 ${esc(r.next12hAmountDisplay||fmt(r.next12h,1))}mm · 강수확률 최대 ${fmt(Math.max(r.next3hProbability||0,r.next12hProbability||0))}%`,
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
    const officialAlerts=data.alerts.filter(
      a=>
        a.scope==='seoul-direct' &&
        a.source==='official' &&
        isImportantOperationAlert(a)
    );
    const preliminaryAlerts=data.alerts.filter(
      a=>
        a.scope==='seoul-direct' &&
        a.source==='preliminary' &&
        isImportantOperationAlert(a)
    );
    const upstreamAlerts=data.alerts.filter(
      a=>
        a.scope==='paldang-upstream' &&
        isImportantOperationAlert(a)
    );
    const officialUnclassifiedAlerts=data.alerts.filter(
      a=>
        a.scope==='official-unclassified' &&
        isImportantOperationAlert(a)
    );
    const stopAlerts=officialAlerts.filter(a=>{
      const text=`${a.title||''} ${a.message||''}`.replace(/\s+/g,'');
      return alertKeywords.some(keyword=>text.includes(String(keyword).replace(/\s+/g,'')));
    });

    if(stopAlerts.length){
      const names=[...new Set(stopAlerts.map(a=>a.title).filter(Boolean))].join(' · ');
      east='stop';
      west='stop';
      const alertReason=reason(
        `운항중지 특보 발효 · ${names||'호우경보 · 강풍주의보 이상 · 태풍주의보 이상'}`,
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
      eastReasons.push(reason('서울 호우·강풍·태풍 운항중지 특보 없음','normal','정상'));
      westReasons.push(reason('서울 호우·강풍·태풍 운항중지 특보 없음','normal','정상'));
    }

    if(upstreamAlerts.length){
      const names=[...new Set(
        upstreamAlerts.map(a=>a.title).filter(Boolean)
      )].join(' · ');

      const upstreamReason=reason(
        `${names} · 팔당 방류 증가 가능성 참고`,
        'info','상류참고'
      );
      eastReasons.push(upstreamReason);
      westReasons.push({...upstreamReason});
    }

    if(officialUnclassifiedAlerts.length){
      const names=[...new Set(
        officialUnclassifiedAlerts
          .map(a=>a.title)
          .filter(Boolean)
      )].join(' · ');

      const officialReason=reason(
        `${names} · 공식 발표 상세지역 확인`,
        'info','공식확인'
      );
      eastReasons.push(officialReason);
      westReasons.push({...officialReason});
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

    if($('eastRoute')&&$('westRoute'))renderRoutes(calc);
    if($('jamsuHero')&&$('jamsuChart'))renderJamsu(calc);
    if($('damMetrics')&&$('damChart'))renderDam(calc);
    if($('alertList'))renderAlerts();
    if($('weatherAlertBanner'))renderWeatherAlertBanner();
    if($('rainCards'))renderRain();
    if($('windGrid'))renderWind();
    if($('riverGrid'))renderRiver();
    if($('tideGrid')&&$('tideChart'))renderTide();
    if($('healthGrid'))renderHealth();

    if($('updatedAt')){
      $('updatedAt').textContent=`화면 갱신 ${dateTimeText(data.meta.generatedAt)}`;
    }

    window.HANGANG_LATEST_DATA=data;
    window.dispatchEvent(new CustomEvent('hangangbus-data-rendered',{
      detail:{data,calc}
    }));
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
    $('eastRoute').className=`route-card east-route ${c.east}`;$('eastRoute').innerHTML=routeCard('동부선',c.east,c.eastReasons,eastBasis);
    $('westRoute').className=`route-card west-route ${c.west}`;$('westRoute').innerHTML=routeCard('서부선',c.west,c.westReasons,westBasis);
  }

  function comparisonCell(label,time,current,previous,digits=2,unit='m',inverse=false){
    const d=current-previous;
    return `<div class="comparison-cell"><span>${label} · ${time}</span><b>${fmt(previous,digits)}${unit}</b><em class="${deltaClass(d,inverse)}">현재 대비 ${signed(d,digits,unit)}</em></div>`;
  }

  function renderJamsu(c){
    const j=data.hydrology.jamsuBridge;
    const h=j.history;
    const cur=j.waterLevelM;

    /*
     * 통과높이는 수위와 반대로 움직입니다.
     * 현재 통과높이와 10분 전 통과높이를 비교합니다.
     * 국내 주식 시세 방식:
     * - 상승: 적색
     * - 하락: 청색
     */
    const previousLevel10m=historyValue(h,1);
    const previousClearance10m=
      Number.isFinite(previousLevel10m)
        ? cfg.STRUCTURE_HEIGHT_M-previousLevel10m
        : c.clearance;
    const clearanceDelta10m=
      c.clearance-previousClearance10m;
    const clearanceTrendClass=
      clearanceDelta10m>0.004
        ? 'rise'
        : clearanceDelta10m<-0.004
          ? 'fall'
          : 'flat';
    const clearanceTrendSymbol=
      clearanceTrendClass==='rise'
        ? '▲'
        : clearanceTrendClass==='fall'
          ? '▼'
          : '―';
    const clearanceTrendWord=
      clearanceTrendClass==='rise'
        ? '상승'
        : clearanceTrendClass==='fall'
          ? '하락'
          : '보합';

    const changeCard=(label,steps)=>{
      const point=historyPoint(h,steps);
      const previous=historyValue(h,steps);
      const delta=cur-previous;

      return `<div class="jamsu-change-card">
        <div class="jamsu-change-head">
          <span>${label}</span>
          <em>${timeText(point.timestamp)}</em>
        </div>
        <b>${fmt(previous,2)}m</b>
        <small>잠수교 수위</small>
        <strong class="${deltaClass(delta)}">현재 대비 ${signed(delta,2,'m')}</strong>
      </div>`;
    };

    $('jamsuHero').className=`jamsu-hero ${c.jamsu}`;
    $('jamsuHero').innerHTML=`
      <div class="jamsu-top-row">
        <div class="data-time">관측 ${fullDateTimeText(j.observedAt)} · ${j.intervalMinutes}분 간격</div>
        <div class="jamsu-stop-standard">
          <span>운항중지 기준 통과높이</span>
          <b>${fmt(cfg.THRESHOLDS.jamsu.stopClearanceM,2)}m 이하</b>
        </div>
      </div>

      <div class="jamsu-primary-grid">
        <div class="jamsu-primary clearance-primary">
          <span>현재 잠수교 통과높이</span>

          <div class="clearance-value-row">
            <b>${fmt(c.clearance,2)}m</b>

            <div class="clearance-stock-trend ${clearanceTrendClass}">
              <strong>
                ${clearanceTrendSymbol}
                ${signed(clearanceDelta10m,2,'m')}
                ${clearanceTrendWord}
              </strong>
              <em>10분 전 대비</em>
            </div>
          </div>

          <em>${statusText[c.jamsu]}</em>
        </div>

        <div class="jamsu-primary level-primary">
          <span>현재 잠수교 수위</span>
          <b>${fmt(cur,2)}m</b>
          <em>${timeText(j.observedAt)} 관측</em>
        </div>
      </div>

      <div class="jamsu-change-title">
        <h4>시간대별 잠수교 수위 변화</h4>
        <span>현재 수위와 비교</span>
      </div>

      <div class="jamsu-change-grid">
        ${changeCard('10분 전',1)}
        ${changeCard('30분 전',3)}
        ${changeCard('1시간 전',6)}
      </div>`;

    $('jamsuChartMeta').textContent=
      `${timeText(h[0].timestamp)}~${timeText(last(h).timestamp)} · 10분 간격`;

    const chartValues=h
      .map(row=>Number(row.value))
      .filter(Number.isFinite);
    const referenceValues=[4.10,4.46];
    const rawMin=Math.min(...chartValues,...referenceValues);
    const rawMax=Math.max(...chartValues,...referenceValues);
    const rawSpan=Math.max(rawMax-rawMin,0.40);
    const padding=Math.max(0.10,rawSpan*0.10);
    const chartMin=Math.max(0,Math.floor((rawMin-padding)*10)/10);
    const chartMax=Math.ceil((rawMax+padding)*10)/10;

    lineChart($('jamsuChart'),h,{
      key:'value',
      min:chartMin,
      max:chartMax,
      lines:[
        {v:4.10,color:'#d89a16',dash:'11 6',className:'caution'},
        {v:4.46,color:'#d43942',dash:'4 4',className:'stop'}
      ],
      color:'#2499d8'
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

  function alertPriority(alert){
    if(alert?.level==='warning')return 0;
    if(alert?.level==='advisory')return 1;
    if(alert?.source==='preliminary'||alert?.level==='watch')return 2;
    if(alert?.scope==='paldang-upstream'||alert?.level==='reference')return 3;
    return 8;
  }

  function alertScopePriority(alert){
    if(alert?.scope==='seoul-direct')return 0;
    if(alert?.scope==='paldang-upstream')return 1;
    return 2;
  }

  function releaseMatchesActiveAlert(alert,release){
    if(!alert||!release)return false;

    const alertTime=new Date(alert.issuedAt||0).getTime();
    const releaseTime=new Date(release.issuedAt||0).getTime();

    if(
      !Number.isFinite(alertTime)||
      !Number.isFinite(releaseTime)||
      releaseTime<alertTime
    ){
      return false;
    }

    const alertTypes=Array.isArray(alert.weatherTypes)
      ? alert.weatherTypes
      : [];
    const releaseTypes=Array.isArray(release.weatherTypes)
      ? release.weatherTypes
      : [];

    if(!alertTypes.some(type=>releaseTypes.includes(type))){
      return false;
    }

    if(
      release.scope==='official-unclassified'||
      alert.scope==='official-unclassified'
    ){
      return true;
    }

    return release.scope===alert.scope;
  }

  function activeOperationAlerts(){
    const releases=data.alertReleases||[];

    return [...(data.alerts||[])]
      .filter(alert=>
        alert?.scope==='seoul-direct' &&
        alert?.operationImpact!==false
      )
      .filter(isImportantOperationAlert)
      .filter(alert=>
        !releases.some(release=>
          releaseMatchesActiveAlert(alert,release)
        )
      )
      .sort((a,b)=>
        alertPriority(a)-alertPriority(b)||
        alertScopePriority(a)-alertScopePriority(b)||
        new Date(b.issuedAt||0)-new Date(a.issuedAt||0)
      );
  }

  function recentReleaseNotices(){
    return [...(data.alertReleases||[])]
      .filter(release=>
        isImportantOperationAlert(release)
      )
      .filter(release=>{
        const time=new Date(release.issuedAt||0).getTime();
        const age=Date.now()-time;
        return Number.isFinite(time)&&
          age>=0&&
          age<=24*60*60000;
      })
      .sort(
        (a,b)=>
          new Date(b.issuedAt||0)-
          new Date(a.issuedAt||0)
      )
      .slice(0,4);
  }

  function alertEffectiveLabel(alert){
    if(alert?.periodText&&
       alert.periodText!=='기상청 발표 원문 참고'){
      return alert.periodText;
    }

    if(alert?.effectiveAt&&alert?.effectiveEndAt){
      return `${fullDateTimeText(alert.effectiveAt)} ~ ${fullDateTimeText(alert.effectiveEndAt)}`;
    }

    if(alert?.effectiveAt){
      return fullDateTimeText(alert.effectiveAt);
    }

    return '발효시간은 기상청 발표 원문 참고';
  }

  function renderWeatherAlertBanner(){
    const root=$('weatherAlertBanner');
    if(!root)return;
    const allActiveAlerts=activeOperationAlerts();

    const directAlerts=allActiveAlerts
      .filter(alert=>alert.scope==='seoul-direct');

    const alerts=directAlerts;

    if(!alerts.length){
      root.hidden=true;
      root.className='weather-alert-banner';
      root.innerHTML='';
      return;
    }

    const alert=alerts[0];
    const extra=alerts.length-1;
    const isUpstream=false;
    const isUnclassified=false;
    const bannerClass=alert.source==='preliminary'
        ? 'watch'
        : alert.level==='warning'
          ? 'warning'
          : 'advisory';

    const sourceLabel=isUpstream
      ? '팔당 상류 참고'
      : isUnclassified
        ? '공식 특보 발표'
        : alert.source==='preliminary'
          ? '예비특보'
          : alert.level==='warning'
            ? '경보'
            : '주의보';

    root.hidden=false;
    root.className=`weather-alert-banner ${bannerClass}`;
    root.innerHTML=`
      <a href="#alerts" class="weather-alert-banner-link">
        <span class="weather-alert-icon">${bannerClass==='warning'?'!':bannerClass==='reference'?'↗':'⚠'}</span>
        <span class="weather-alert-banner-copy">
          <b>${isUpstream||isUnclassified?'':'서울 '}${esc(sourceLabel)} · ${esc(alert.title)}</b>
          <em>
            발표 ${fullDateTimeText(alert.issuedAt)}
            · 발효${alert.source==='preliminary'?'예정':''} ${esc(alertEffectiveLabel(alert))}
            ${extra>0?` · 추가 ${extra}건`:''}
          </em>
        </span>
        <strong>특보 확인</strong>
      </a>`;
  }

  function renderAlerts(){
    const root=$('alertList');
    const alerts=activeOperationAlerts();
    const releases=recentReleaseNotices();
    const status=data.alertStatus||{};
    const area=status.area||'서울특별시·수도권';
    const issuedAt=
      data.meta.dataTimes.weatherForecastIssued||
      data.meta.generatedAt;

    const activeMarkup=alerts.length
      ? `
        <div class="alert-list-section-head">
          <div>
            <b>현재 발효·예정 특보</b>
            <span>경보 → 주의보 → 예비특보 순</span>
          </div>
          <em>${alerts.length}건</em>
        </div>

        ${alerts.map(a=>{
          const sourceLabel=
            a.scope==='paldang-upstream'
              ? '팔당 상류 참고'
              : a.scope==='official-unclassified'
                ? '기상청 공식 발표'
                : a.source==='official'
                  ? '서울 기상청 공식'
                  : a.source==='preliminary'
                    ? '서울 기상청 예비'
                    : '한강버스 내부';

          const levelLabel=
            a.levelLabel||
            (a.level==='warning'
              ? '경보'
              : a.level==='advisory'
                ? '주의보'
                : '예비특보');

          const effectiveLabel=alertEffectiveLabel(a);
          const periodTitle=
            a.source==='preliminary'
              ? '발효예정'
              : '발효시각';

          return `<article class="alert-card ${esc(
            a.scope==='paldang-upstream'
              ? 'upstream'
              : a.scope==='official-unclassified'
                ? 'official-reference'
                : a.source==='internal'
                  ? 'internal'
                  : a.level
          )}">
            <div class="alert-top">
              <div>
                <div class="alert-tags">
                  <span class="tag ${a.source==='internal'?'internal':''}">${sourceLabel}</span>
                  <span class="tag alert-level-tag ${esc(a.level)}">${esc(levelLabel)}</span>
                  <span class="tag">${esc(a.area)}</span>
                </div>
                <h3>${esc(a.title)}</h3>
              </div>
              <span class="alert-time">발표 ${dateTimeText(a.issuedAt)}</span>
            </div>

            <div class="alert-time-grid">
              <div>
                <span>발표시각</span>
                <b>${fullDateTimeText(a.issuedAt)}</b>
              </div>
              <div>
                <span>${periodTitle}</span>
                <b>${esc(effectiveLabel)}</b>
              </div>
            </div>

            ${a.scope==='paldang-upstream'
              ? '<div class="alert-scope-note">운항중지 직접판정에는 반영하지 않고 팔당댐 방류 증가 가능성 참고자료로 사용합니다.</div>'
              : a.scope==='official-unclassified'
                ? '<div class="alert-scope-note">기상청 공식 발표는 확인됐으나 상세지역 해석이 필요해 운항중지에는 직접 반영하지 않습니다.</div>'
                : '<div class="alert-scope-note direct">서울 직접특보로 운항판정에 반영합니다.</div>'}

            <details class="alert-original">
              <summary>기상청 발표 원문 보기</summary>
              <p>${esc(a.message)}</p>
            </details>
          </article>`;
        }).join('')}
      `
      : `
        <article class="alert-card clear">
          <div class="alert-top">
            <div>
              <div class="alert-tags">
                <span class="tag">기상청 공식</span>
                <span class="tag">${esc(area)}</span>
              </div>
              <h3>현재 유효한 운항 관련 특보 없음</h3>
            </div>
            <span class="alert-time">확인 ${dateTimeText(issuedAt)}</span>
          </div>
          <p>서울 호우·강풍·태풍 발효특보 및 예비특보 기준</p>
          <div class="alert-period ${status.sourceMode==='official-warning-api'?'':'alert-source-warning'}">
            <span>조회 기준 ${fullDateTimeText(data.meta.generatedAt)}</span>
            <b>호우·강풍·태풍만 표시</b>
          </div>
        </article>
      `;

    const releaseMarkup=releases.length
      ? `
        <div class="alert-release-section">
          <div class="alert-release-section-head">
            <div>
              <b>최근 해제·취소 발표</b>
              <span>현재 특보 목록에서는 제거된 항목</span>
            </div>
            <em>24시간 이내</em>
          </div>

          <div class="alert-release-list">
            ${releases.map(release=>{
              const action=release.action==='cancelled'
                ? '취소됨'
                : '해제됨';

              return `
                <article class="alert-release-notice ${esc(release.action||'released')}">
                  <span class="alert-release-symbol">
                    ${release.action==='cancelled'?'×':'✓'}
                  </span>
                  <div class="alert-release-copy">
                    <div>
                      <b>${esc(release.title||`기상특보 ${action}`)}</b>
                      <strong>${action}</strong>
                    </div>
                    <p>
                      ${esc(release.area||'상세지역 확인')}
                      · ${fullDateTimeText(release.issuedAt)} 해제·취소 발표
                    </p>
                    <details>
                      <summary>발표 원문 확인</summary>
                      <span>${esc(release.message||release.officialTitle||'-')}</span>
                    </details>
                  </div>
                </article>
              `;
            }).join('')}
          </div>
        </div>
      `
      : '';

    root.innerHTML=activeMarkup+releaseMarkup;
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
    const probability=Number(row?.probability)||0;
    const pty=Number(row?.pty)||0;
    const upper=row?.amountUpper===null
      ? null
      : Number(row?.amountUpper);
    const hasForecastAmount=
      row?.hasAmount===true ||
      upper===null ||
      (Number.isFinite(upper)&&upper>0);

    if(hasForecastAmount&&[1,4,5].includes(pty)){
      return {icon:'🌧️',label:'비',className:'rain-now'};
    }

    if(hasForecastAmount&&[2,6].includes(pty)){
      return {icon:'🌨️',label:'비·눈',className:'rain-now'};
    }

    if(hasForecastAmount&&[3,7].includes(pty)){
      return {icon:'❄️',label:'눈',className:'rain-now'};
    }

    if(probability>=20){
      return {
        icon:'🌦️',
        label:'비 가능성 있음',
        className:'rain-possible'
      };
    }

    return {
      icon:'☀️',
      label:'강수 예보 없음',
      className:'rain-none'
    };
  }

  function rainDisplay(value,fallbackNumber){
    const text=String(value??'').trim();
    if(text)return text;
    return fmt(fallbackNumber,1);
  }

  function rainWindowText(startAt,hours){
    const start=toDate(startAt);
    if(!start||Number.isNaN(start.getTime()))return '-';

    const end=new Date(start.getTime()+Number(hours)*60*60*1000);
    const startDate=start.toLocaleDateString('ko-KR',{
      month:'2-digit',
      day:'2-digit'
    }).replace(/\s/g,'');

    const endDate=end.toLocaleDateString('ko-KR',{
      month:'2-digit',
      day:'2-digit'
    }).replace(/\s/g,'');

    const startTime=start.toLocaleTimeString('ko-KR',{
      hour:'2-digit',
      minute:'2-digit',
      hour12:false
    });

    const endTime=end.toLocaleTimeString('ko-KR',{
      hour:'2-digit',
      minute:'2-digit',
      hour12:false
    });

    return startDate===endDate
      ? `${startTime}~${endTime}`
      : `${startDate} ${startTime}~${endDate} ${endTime}`;
  }

  function rainAmountMarkup(row){
    if(row?.amountAvailable===false){
      return `<span class="rain-amount-missing">미제공</span>`;
    }

    const amount=rainDisplay(row?.amountDisplay,row?.amount);
    const note=row?.amountQualifier==='none'
      ? '<em class="rain-zero-note">정량 강수 없음</em>'
      : '';

    return `${amount}<small>mm</small>${note}`;
  }

  function rainfallContributorText(rows){
    if(!Array.isArray(rows)||!rows.length){
      return '<span class="rain-contribution-empty">정량 강수 예상시간 없음</span>';
    }

    return rows.map(row=>
      `<span class="rain-contribution-chip">
        <b>${dateTimeText(row.time)}</b>
        <em>${esc(row.amountDisplay)}mm</em>
      </span>`
    ).join('');
  }

  function rainfallContributionSummary(rows){
    if(!Array.isArray(rows)||!rows.length){
      return {
        period:'정량 강수 예상시간 없음',
        count:0,
        maximum:'-',
        maximumTime:'-'
      };
    }

    const sorted=[...rows].sort(
      (a,b)=>new Date(a.time)-new Date(b.time)
    );

    const maximum=[...rows].sort(
      (a,b)=>(Number(b.amountSafety)||0)-(Number(a.amountSafety)||0)
    )[0];

    return {
      period:`${dateTimeText(sorted[0].time)} ~ ${dateTimeText(sorted.at(-1).time)}`,
      count:rows.length,
      maximum:maximum?.amountDisplay||'-',
      maximumTime:dateTimeText(maximum?.time)
    };
  }

  function renderRain(){
    const names={west:'서부선',east:'동부선'};

    $('rainCards').innerHTML=['west','east'].map(k=>{
      const r=data.weather.rainfall[k];

      const summaries=[
        ['향후 3시간 강수량 예보',3,r.next3hDisplay,r.next3hAmountDisplay,r.next3hReliable],
        ['향후 6시간 강수량 예보',6,r.next6hDisplay,r.next6hAmountDisplay,r.next6hReliable],
        ['향후 12시간 강수량 예보',12,r.next12hDisplay,r.next12hAmountDisplay,r.next12hReliable],
        ['향후 24시간 강수량 예보',24,r.next24hDisplay,r.next24hAmountDisplay,r.next24hReliable]
      ];

      const contribution=rainfallContributionSummary(
        r.rainContributors
      );

      const rows=(r.timeline||[]).map(x=>{
        const visual=rainVisual(x);

        return `<div class="rain-hour-card ${visual.className}">
          <div class="rain-hour-top">
            <div class="rain-hour-time">${esc(x.label)}</div>
            <div class="rain-weather-icon" aria-label="${esc(visual.label)}">${visual.icon}</div>
          </div>
          <div class="rain-weather-label">${esc(visual.label)}</div>
          <div class="rain-hour-amount" title="기상청 PCP 원문: ${esc(x.rawAmount||'-')}">${rainAmountMarkup(x)}</div>
          <div class="rain-hour-probability">
            <span>강수확률</span>
            <b>${fmt(x.probability)}%</b>
          </div>
        </div>`;
      }).join('');

      const notice=!r.dataAvailable
        ? `<div class="rain-state missing"><b>강수자료 확인 필요</b><span>${esc(r.dryMessage)}</span></div>`
        : r.allDry
          ? `<div class="rain-state dry"><b>현재 강수 없음</b><span>시간별 강수확률과 비 여부는 아래 표에서 확인하십시오.</span></div>`
          : '';

      return `<article class="sector-card rain-card-v59">
        <div class="data-time">
          실황 ${dateTimeText(r.observedAt)} · 예보 발표 ${dateTimeText(r.forecastIssuedAt)} · 첫 예보 ${dateTimeText(r.forecastStartAt)}
        </div>

        <div class="sector-title rain-sector-title">
          <h3>${names[k]}</h3>
          <span class="rain-basis-badge">${esc(r.representativeName||'-')} 단일지점 기준</span>
        </div>

        <div class="rain-current-row">
          <div>
            <span>최근 1시간 실황</span>
            <b>${fmt(r.currentRate,1)}mm</b>
            <em>${timeText(r.observedAt)} 관측</em>
          </div>
          <div>
            <span>시간별 예보 시작</span>
            <b>${timeText(r.forecastStartAt)}</b>
            <em>시간별 강수예보</em>
          </div>
        </div>

        ${notice}

        <div class="rain-summary rain-summary-v57">
          ${summaries.map(x=>{
            const reliable=x[4]!==false;
            const mainValue=reliable
              ? rainDisplay(x[2],x[3])
              : '부분자료';

            const longValue=String(mainValue).length>=7;

            return `<div class="rain-item ${reliable?'':'rain-summary-partial'}">
              <span class="rain-summary-title">${x[0]}</span>
              <em class="rain-summary-window">${rainWindowText(r.forecastStartAt,x[1])}</em>
              <b class="rain-summary-amount ${longValue?'rain-value-long':''}">
                ${mainValue}${reliable?'<small>mm</small>':''}
              </b>
              ${reliable?'':'<em class="rain-summary-missing">일부 시각 미제공</em>'}
            </div>`;
          }).join('')}
        </div>

        <details class="rain-contribution-box">
          <summary class="rain-contribution-summary">
            <div class="rain-contribution-summary-main">
              <b>24시간 누적 강수 근거</b>
              <span>${esc(contribution.period)}</span>
            </div>
            <div class="rain-contribution-summary-max">
              <span>최대 시간강수</span>
              <b>${esc(contribution.maximumTime)} · ${esc(contribution.maximum)}mm</b>
            </div>
            <em class="rain-contribution-toggle">상세보기</em>
          </summary>

          <div class="rain-contribution-detail">
            <div class="rain-contribution-note">
              향후 8시간 카드 이후의 시간도 24시간 누적에 포함됩니다.
            </div>
            <div class="rain-contribution-list">
              ${rainfallContributorText(r.rainContributors)}
            </div>
            ${(r.missingAmountHours||[]).length
              ? `<div class="rain-missing-hours">강수량 미제공 시각 ${(r.missingAmountHours||[]).map(x=>dateTimeText(x.time)).join(' · ')}</div>`
              : ''}
          </div>
        </details>

        <div class="rain-table-heading">
          <h4>예상 강수량(향후 ${fmt(r.timelineHours||8)}시간)</h4>
          <span>${esc(r.representativeName||'-')} ${esc(coordinateText(r.representativeLat,r.representativeLon)||'좌표 확인 중')}</span>
        </div>

        <div class="rain-hour-scroll rain-hour-scroll-v59">
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
  function coordinateText(lat,lon){
    const y=Number(lat),x=Number(lon);
    if(!Number.isFinite(y)||!Number.isFinite(x))return '';
    return `${y.toFixed(5)}°N, ${x.toFixed(5)}°E`;
  }
  function validWindForecast(x){
    return Boolean(x && Number.isFinite(Number(x.speed)));
  }
  function forecastWindCard(x){
    if(!validWindForecast(x))return `<div class="wind-forecast-card unavailable"><span>풍향·풍속 예보 없음</span></div>`;
    const hasWind=Number.isFinite(Number(x.speed));
    return `<div class="wind-forecast-card">
      <div class="wind-forecast-head"><span>${x.hour}시간 후</span><b>${timeText(x.time)}</b></div>
      <div class="wind-forecast-body no-forecast-temp">
        ${hasWind?compass(x.directionDeg,x.speed,true):'<div class="wind-forecast-placeholder">-</div>'}
        <div class="wind-forecast-reading">
          <strong>${hasWind?`${fmt(x.speed,1)}m/s`:'풍속 -'}</strong>
          <em>${hasWind?esc(x.direction||'풍향 확인 중'):'풍향 자료 없음'}</em>
        </div>
      </div>
    </div>`;
  }
  function renderWind(){
    $('windGrid').innerHTML=data.weather.windStations.map(w=>{
      const coordinate=coordinateText(w.lat,w.lon);

      return `<article class="station-card wind-card-v59">
        <div class="station-head wind-station-head">
          <div>
            <h3>${esc(w.name)}</h3>
            <div class="station-coordinate">${coordinate?esc(coordinate):'좌표 확인 중'}</div>
          </div>
          <span class="sector-pill sector-pill-v59">${w.sector==='east'?'동부선':'서부선'}</span>
        </div>

        <div class="wind-current-compact">
          <div class="wind-current-compass">
            ${compass(w.directionDeg,w.speed,true)}
          </div>
          <div class="wind-current-value">
            <span>현재 ${timeText(w.observedAt)}</span>
            <b class="${windLevel(w)}">${fmt(w.speed,1)}<small>m/s</small></b>
            <em>${esc(w.direction||'풍향 확인 중')}${Number.isFinite(Number(w.directionDeg))?` · ${fmt(w.directionDeg)}°`:''}</em>
          </div>
          <div class="wind-temp-reference current">
            <span>참고 기온</span>
            <b>${Number.isFinite(Number(w.temperature))?`${fmt(w.temperature,1)}℃`:'-'}</b>
          </div>
        </div>

        <div class="wind-forecast-grid-v59">
          ${[1,2].map(h=>forecastWindCard(w.forecasts?.find(x=>x.hour===h))).join('')}
        </div>
      </article>`;
    }).join('');
  }

  function riverMetric(name,obj){
    const h=obj.history,cur=obj.waterLevelM,d10=historyDelta(h,1),d30=historyDelta(h,3),d60=historyDelta(h,6);
    return `<article class="metric river-metric"><div class="data-time">관측 ${fullDateTimeText(obj.observedAt)} · ${obj.intervalMinutes}분 간격</div><div class="metric-label">${name}</div><div class="metric-value">${fmt(cur,2)}m</div><div class="comparison-list"><div><span>10분 전 ${timeText(historyPoint(h,1).timestamp)}</span><b>${fmt(historyValue(h,1),2)}m</b><em class="${deltaClass(d10)}">${signed(d10,2,'m')}</em></div><div><span>30분 전 ${timeText(historyPoint(h,3).timestamp)}</span><b>${fmt(historyValue(h,3),2)}m</b><em class="${deltaClass(d30)}">${signed(d30,2,'m')}</em></div><div><span>1시간 전 ${timeText(historyPoint(h,6).timestamp)}</span><b>${fmt(historyValue(h,6),2)}m</b><em class="${deltaClass(d60)}">${signed(d60,2,'m')}</em></div></div></article>`;
  }
  function renderRiver(){
    const jamsu=data.hydrology.jamsuBridge;
    const hangang=data.hydrology.hangangBridge;
    $('riverGrid').innerHTML=riverMetric('잠수교 수위',jamsu)+riverMetric('한강대교 수위',hangang);
    if($('riverMapJamsuValue'))$('riverMapJamsuValue').textContent=`${fmt(jamsu.waterLevelM,2)}m · ${timeText(jamsu.observedAt)}`;
    if($('riverMapHangangValue'))$('riverMapHangangValue').textContent=`${fmt(hangang.waterLevelM,2)}m · ${timeText(hangang.observedAt)}`;
  }

  function tideEventCard(label,event,referenceAt){
    if(!event){
      return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">-</div><div class="metric-sub">익일 고·저조 자료 연결 필요</div></div>`;
    }
    return `<div class="metric"><div class="data-time">자료 갱신 ${dateTimeText(data.tide.updatedAt)}</div><div class="metric-label">${esc(label)}</div><div class="metric-value">${timeText(event.time)}</div><div class="metric-sub">${dateTimeText(event.time)} · ${fmt(event.heightCm,0)}cm</div><div class="event-countdown">기준시각부터 ${durationText(referenceAt,event.time)}</div></div>`;
  }

  function tideChart(svg,t){
    const history=t.timeline||[];
    if(!history.length){svg.innerHTML='';return;}

    const H=300;
    const W=responsiveChartWidth(svg,H);
    const left=60,right=28,top=68,bottom=44;
    const plotWidth=W-left-right;
    const plotHeight=H-top-bottom;

    const values=history.map(x=>Number(x.heightCm)).filter(Number.isFinite);
    const min=Math.floor((Math.min(...values)-40)/50)*50;
    const max=Math.ceil((Math.max(...values)+40)/50)*50;

    const x=i=>history.length<=1
      ? left+plotWidth/2
      : left+i*plotWidth/(history.length-1);

    const y=v=>top+(max-v)*plotHeight/Math.max(1,max-min);

    const ticks=Array.from({length:5},(_,i)=>min+(max-min)*i/4);
    const grid=ticks.map(v=>
      `<line class="chart-grid tide-grid-line" x1="${left}" x2="${W-right}" y1="${y(v)}" y2="${y(v)}"/>
       <text class="chart-axis chart-axis-y tide-axis-y" x="${left-10}" y="${y(v)+4}" text-anchor="end">${fmt(v,0)}</text>`
    ).join('');

    const points=history.map((row,i)=>`${x(i)},${y(row.heightCm)}`).join(' ');
    const areaPoints=
      `${left},${H-bottom} ${points} ${W-right},${H-bottom}`;

    const labelStep=Math.max(1,Math.ceil(history.length/8));
    const labels=history.map((row,i)=>
      i%labelStep===0||i===history.length-1
        ? `<text class="chart-axis chart-axis-x tide-axis-x" text-anchor="middle" x="${x(i)}" y="${H-13}">${esc(row.label)}</text>`
        : ''
    ).join('');

    const eventLines=[];
    const eventBadges=[];
    const eventDots=[];

    (t.events||[]).forEach((event,eventIndex)=>{
      const idx=history.reduce((best,row,i)=>
        Math.abs(new Date(row.time)-new Date(event.time)) <
        Math.abs(new Date(history[best].time)-new Date(event.time))
          ? i
          : best
      ,0);

      const eventX=x(idx);
      const eventY=y(event.heightCm);
      const isHigh=event.type==='high';
      const color=isHigh?'#c92f3b':'#126b9c';
      const soft=isHigh?'#fff1f2':'#edf7fc';
      const title=isHigh?'만조':'간조';
      const badgeWidth=126;
      const badgeHeight=42;
      const badgeCenter=Math.max(
        left+badgeWidth/2,
        Math.min(W-right-badgeWidth/2,eventX)
      );
      const badgeX=badgeCenter-badgeWidth/2;
      const badgeY=10;

      eventLines.push(
        `<line class="tide-event-line ${isHigh?'high':'low'}"
          x1="${eventX}" x2="${eventX}"
          y1="${top}" y2="${H-bottom}"
          stroke="${color}" stroke-width="2.6"
          stroke-dasharray="${isHigh?'8 5':'3 5'}"/>`
      );

      eventDots.push(
        `<circle cx="${eventX}" cy="${eventY}" r="6.5"
          fill="${color}" stroke="#fff" stroke-width="3"/>`
      );

      eventBadges.push(
        `<g class="tide-event-badge">
          <rect x="${badgeX}" y="${badgeY}"
            width="${badgeWidth}" height="${badgeHeight}"
            rx="8" fill="${soft}" stroke="${color}" stroke-width="1.5"/>
          <text x="${badgeCenter}" y="${badgeY+16}"
            text-anchor="middle" fill="${color}"
            font-size="10" font-weight="900">${title} ${timeText(event.time)}</text>
          <text x="${badgeCenter}" y="${badgeY+32}"
            text-anchor="middle" fill="#183d52"
            font-size="11" font-weight="900">${fmt(event.heightCm,0)}cm</text>
        </g>`
      );
    });

    const currentIndex=history.reduce((best,row,i)=>
      Math.abs(new Date(row.time)-Date.now()) <
      Math.abs(new Date(history[best].time)-Date.now())
        ? i
        : best
    ,0);

    const currentX=x(currentIndex);
    const nowBadgeWidth=94;
    const nowBadgeX=Math.max(
      left,
      Math.min(W-right-nowBadgeWidth,currentX-nowBadgeWidth/2)
    );

    const gradientId=`tide-area-${svg.id||'chart'}`;

    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    svg.setAttribute('tabindex','0');
    svg.innerHTML=`
      <defs>
        <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#62b8dc" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="#62b8dc" stop-opacity="0.04"/>
        </linearGradient>
      </defs>
      ${grid}
      <text class="tide-unit-label" x="${left-42}" y="${top-10}">cm</text>
      ${eventLines.join('')}
      <polygon points="${areaPoints}" fill="url(#${gradientId})"/>
      <polyline class="chart-line tide-main-line" stroke="#0e86bb" points="${points}"/>
      ${eventDots.join('')}
      ${labels}
      <line class="tide-current-line"
        x1="${currentX}" x2="${currentX}"
        y1="${top}" y2="${H-bottom}"
        stroke="#243e50" stroke-width="3"/>
      <rect x="${nowBadgeX}" y="${top+6}"
        width="${nowBadgeWidth}" height="24"
        rx="7" fill="#243e50"/>
      <text x="${nowBadgeX+nowBadgeWidth/2}" y="${top+22}"
        text-anchor="middle" fill="#fff"
        font-size="9" font-weight="900">현재 ${timeText(history[currentIndex].time)}</text>
      ${eventBadges.join('')}
      <g class="chart-hover-layer" style="display:none">
        <line class="chart-hover-line"/>
        <circle class="chart-hover-dot" r="6"/>
      </g>`;

    bindChartTooltip(svg,{
      history,left,plotWidth,top,bottomY:H-bottom,x,
      series:[{key:'heightCm',y,color:'#0e86bb'}],
      format:(row,index)=>{
        const prev=index>0?Number(history[index-1].heightCm):null;
        const delta=prev===null?null:Number(row.heightCm)-prev;
        return `<div class="chart-tooltip-time">${esc(dateTimeText(row.time))}</div>
          <div class="chart-tooltip-row"><span>예측조위</span><b>${fmt(row.heightCm,1)}cm</b></div>
          <div class="chart-tooltip-row"><span>10분 변화</span><b class="${delta===null?'':deltaClass(delta)}">${delta===null?'-':signed(delta,1,'cm')}</b></div>`;
      }
    });

    observeResponsiveChart(svg,()=>tideChart(svg,t));
  }

  function monthlyEventText(events){
    if(!Array.isArray(events)||!events.length)return '-';
    return events.map(event=>
      `${timeText(event.time)} ${fmt(event.heightCm,0)}cm`
    ).join('<br>');
  }

  function renderMonthlyTide(t){
    const monthly=t.monthly;
    const daily=monthly?.daily||[];
    const summary=monthly?.summary||{};

    if(!daily.length){
      $('tideMonthlySummary').innerHTML=
        `<div class="monthly-summary-card warning">
          <span>30일 전망</span>
          <b>자료 확인</b>
          <em>${esc(t.monthlyError||'월간 조석자료를 불러오지 못했습니다.')}</em>
        </div>`;
      $('tideMonthlyBody').innerHTML=
        '<tr><td colspan="6">월간 조석자료 없음</td></tr>';
      return;
    }

    const firstSpring=daily.find(day=>day.cycleClass==='대조기권');
    const firstNeap=daily.find(day=>day.cycleClass==='소조기권');
    const highest=summary.highestHigh;
    const maxRange=summary.maxRangeDay;

    $('tideMonthlySummary').innerHTML=[
      {
        label:'30일 최대조차',
        value:maxRange?`${fmt(maxRange.rangeCm,0)}cm`:'-',
        sub:maxRange?dateOnlyText(`${maxRange.date}T00:00:00+09:00`):'-',
        cls:'spring'
      },
      {
        label:'다음 대조기권',
        value:firstSpring?dateOnlyText(`${firstSpring.date}T00:00:00+09:00`):'-',
        sub:firstSpring?`일 조차 ${fmt(firstSpring.rangeCm,0)}cm`:'조차 기준 추정',
        cls:'spring'
      },
      {
        label:'다음 소조기권',
        value:firstNeap?dateOnlyText(`${firstNeap.date}T00:00:00+09:00`):'-',
        sub:firstNeap?`일 조차 ${fmt(firstNeap.rangeCm,0)}cm`:'조차 기준 추정',
        cls:'neap'
      },
      {
        label:'가장 높은 만조',
        value:highest?`${fmt(highest.heightCm,0)}cm`:'-',
        sub:highest?`${dateOnlyText(highest.time)} ${timeText(highest.time)}`:'-',
        cls:'high'
      }
    ].map(card=>
      `<div class="monthly-summary-card ${card.cls}">
        <span>${card.label}</span>
        <b>${card.value}</b>
        <em>${card.sub}</em>
      </div>`
    ).join('');

    $('tideMonthlyBody').innerHTML=daily.map(day=>{
      const cycleClass=
        day.cycleClass==='대조기권'
          ? 'spring'
          : day.cycleClass==='소조기권'
            ? 'neap'
            : 'middle';

      return `<tr>
        <td>${dateOnlyText(`${day.date}T00:00:00+09:00`)}</td>
        <td><span class="cycle-badge ${cycleClass}">${esc(day.cycleClass||'-')}</span></td>
        <td>${monthlyEventText(day.highs)}</td>
        <td>${monthlyEventText(day.lows)}</td>
        <td><b>${day.rangeCm===null||day.rangeCm===undefined?'-':`${fmt(day.rangeCm,0)}cm`}</b></td>
        <td>${day.rangeCm>=800?'조석 영향 큼':day.rangeCm<=450?'조석 영향 감소':'일반'}</td>
      </tr>`;
    }).join('');
  }

  function renderTide(){
    const t=data.tide;
    const current=t.currentObserved;
    const hasObserved=Boolean(current);
    const observedIsCurrent=Boolean(current?.isCurrent);
    const predicted=t.currentPredicted?.heightCm;
    const deviation=current?.deviationCm;

    const currentLabel=hasObserved
      ? (observedIsCurrent?'현재 실측조위':'마지막 유효 실측')
      : '현재 예측조위';

    const currentTime=hasObserved
      ? current.time
      : t.currentPredicted?.time;

    const currentValue=hasObserved
      ? current.heightCm
      : predicted;

    let currentSub='실측 자료 미수신 · 예측값 표시';
    if(hasObserved){
      currentSub=`동시각 예측 ${current.predictedCm===null||current.predictedCm===undefined?'-':`${fmt(current.predictedCm,1)}cm`}`;
      if(deviation!==null&&deviation!==undefined){
        currentSub+=` · 편차 ${signed(deviation,1,'cm')}`;
      }
      if(!observedIsCurrent){
        currentSub+=` · ${current.ageMinutes}분 전 실측`;
      }
    }

    const tideEvents=(t.events||[]).map(event=>{
      const isHigh=event.type==='high';
      return `<div class="tide-event-chip ${isHigh?'high':'low'}">
        <span>${isHigh?'만조':'간조'}</span>
        <b>${timeText(event.time)}</b>
        <em>${fmt(event.heightCm,0)}cm</em>
      </div>`;
    }).join('');

    $('tideEventStrip').innerHTML=tideEvents ||
      '<div class="tide-event-chip empty">당일 만·간조 자료 없음</div>';

    $('tideGrid').innerHTML=
      `<div class="metric tide-current-metric ${hasObserved?'':'metric-data-warning'}">
        <div class="data-time">인천 ${dateTimeText(currentTime)}</div>
        <div class="metric-label">${currentLabel}</div>
        <div class="metric-value">${currentValue===null||currentValue===undefined?'-':`${fmt(currentValue,1)}cm`}</div>
        <div class="metric-sub">${currentSub}</div>
      </div>`+
      tideEventCard('다음 만조',t.nextHigh,t.referenceAt)+
      tideEventCard('다음 간조',t.nextLow,t.referenceAt)+
      `<div class="metric">
        <div class="data-time">판단 기준 ${dateTimeText(t.referenceAt)}</div>
        <div class="metric-label">현재 조석상태</div>
        <div class="metric-value">${esc(t.phase)}</div>
        <div class="metric-sub">오늘 조차 ${t.rangeCm===null?'-':`${fmt(t.rangeCm,0)}cm`} · ${esc(t.rangeClass||'자료 확인')}<br>방류 중첩위험 ${esc(t.overlapRisk)}</div>
      </div>`;

    const rows=[];
    if(t.previousHigh)rows.push(['이전 만조',t.previousHigh]);
    if(t.previousLow)rows.push(['이전 간조',t.previousLow]);

    if(hasObserved){
      rows.push([
        observedIsCurrent?'현재 실측':'마지막 실측',
        {time:current.time,heightCm:current.heightCm}
      ]);
    }else if(t.currentPredicted){
      rows.push([
        '현재 예측',
        {time:t.currentPredicted.time,heightCm:t.currentPredicted.heightCm}
      ]);
    }

    if(t.nextHigh)rows.push(['다음 만조',t.nextHigh]);
    if(t.nextLow)rows.push(['다음 간조',t.nextLow]);

    $('tideComparisonBody').innerHTML=rows.map(([label,event])=>{
      const isObserved=label==='현재 실측'||label==='마지막 실측';
      const comparison=isObserved&&deviation!==null&&deviation!==undefined
        ? `예측 대비 ${signed(deviation,1,'cm')}`
        : label==='현재 예측'
          ? '실측 미수신'
          : t.phase;

      return `<tr class="${label==='현재 실측'?'current-row':''}">
        <td>${esc(label)}</td>
        <td>${dateTimeText(event.time)}</td>
        <td>${fmt(event.heightCm,1)}cm</td>
        <td>${esc(comparison)}</td>
      </tr>`;
    }).join('');

    tideChart($('tideChart'),t);
    renderMonthlyTide(t);
  }

  function renderHealth(){
    const items=(data.health||[]).filter(x=>x.name!=='수문정보');

    const sourceLabel={
      한강수위:'관측',
      팔당댐:'관측',
      기상관측:'관측',
      기상예보:'발표',
      기상특보:'확인',
      조석:'자료',
      조석정보:'자료'
    };

    $('healthGrid').innerHTML=items.map(x=>{
      const sourceAge=ageMinutes(x.updatedAt);
      const isCached=x.status==='cached';
      const isStored=x.status==='stored';
      const isPartial=x.status==='partial';
      const isError=['error','missing'].includes(x.status);
      const isHydrology=['한강수위','팔당댐'].includes(x.name);
      const hydrologyDelayed=isHydrology&&sourceAge!==null&&sourceAge>60;

      let state='정상';
      let stateClass='good';
      let cardClass='';

      if(isError){
        state='자료 미수신';
        stateClass='bad';
        cardClass='stale';
      }else if(isCached){
        state='직전 정상값';
        stateClass='warn';
        cardClass='stale';
      }else if(isStored){
        state='정상·당일저장';
        stateClass='good';
      }else if(isPartial){
        state='일부자료 미수신';
        stateClass='warn';
        cardClass='source-delay';
      }else if(hydrologyDelayed){
        state='원자료 지연';
        stateClass='warn';
        cardClass='source-delay';
      }

      const checkedAt=x.checkedAt||data.meta?.generatedAt;
      const checkedText=checkedAt
        ? `조회 ${dateTimeText(checkedAt)} · `
        : '';

      const ageText=sourceAge===null
        ? '시각 없음'
        : `${sourceAge}분 전`;

      const attemptText=isCached&&x.lastAttemptAt
        ? ` · 실패 ${dateTimeText(x.lastAttemptAt)}`
        : '';

      return `<div class="health-card ${cardClass}">
        <span>${esc(x.name)}</span>
        <b class="${stateClass}">${state}</b>
        <em>${checkedText}${sourceLabel[x.name]||'원자료'} ${dateTimeText(x.updatedAt)} · ${ageText}${attemptText}</em>
      </div>`;
    }).join('');
  }


  function ensureChartTooltip(svg){
    const host=svg.parentElement;
    host.classList.add('interactive-chart-host');

    let tooltip=host.querySelector(':scope > .chart-hover-tooltip');
    if(!tooltip){
      tooltip=document.createElement('div');
      tooltip.className='chart-hover-tooltip';
      tooltip.hidden=true;
      host.appendChild(tooltip);
    }

    return tooltip;
  }

  function bindChartTooltip(svg,options){
    const tooltip=ensureChartTooltip(svg);
    const history=options.history||[];
    const series=options.series||[];
    const hover=svg.querySelector('.chart-hover-layer');
    const hoverLine=hover?.querySelector('.chart-hover-line');
    const hoverDots=[...(hover?.querySelectorAll('.chart-hover-dot')||[])];

    if(!history.length||!hover||!hoverLine)return;

    const hide=()=>{
      hover.style.display='none';
      tooltip.hidden=true;
    };

    const showAtClientX=clientX=>{
      const rect=svg.getBoundingClientRect();
      if(!rect.width)return;

      const viewBox=svg.viewBox.baseVal;
      const svgX=(clientX-rect.left)/rect.width*viewBox.width;
      const rawIndex=(svgX-options.left)/Math.max(1,options.plotWidth)*(history.length-1);
      const index=Math.max(0,Math.min(history.length-1,Math.round(rawIndex)));
      const row=history[index];
      const pointX=options.x(index);

      hoverLine.setAttribute('x1',pointX);
      hoverLine.setAttribute('x2',pointX);
      hoverLine.setAttribute('y1',options.top);
      hoverLine.setAttribute('y2',options.bottomY);

      series.forEach((item,seriesIndex)=>{
        const dot=hoverDots[seriesIndex];
        if(!dot)return;
        const value=Number(row[item.key]);
        if(!Number.isFinite(value)){
          dot.style.display='none';
          return;
        }
        dot.style.display='block';
        dot.setAttribute('cx',pointX);
        dot.setAttribute('cy',item.y(value));
        dot.setAttribute('fill',item.color);
      });

      hover.style.display='block';
      tooltip.innerHTML=options.format(row,index);
      tooltip.hidden=false;

      const hostRect=svg.parentElement.getBoundingClientRect();
      const desiredLeft=clientX-hostRect.left+13;
      const maxLeft=Math.max(8,hostRect.width-tooltip.offsetWidth-8);
      tooltip.style.left=`${Math.max(8,Math.min(maxLeft,desiredLeft))}px`;
      tooltip.style.top=`${Math.max(38,rect.top-hostRect.top+14)}px`;
    };

    svg.style.touchAction='pan-y';
    svg.onpointermove=event=>showAtClientX(event.clientX);
    svg.onpointerdown=event=>showAtClientX(event.clientX);
    svg.onpointerleave=event=>{
      if(event.pointerType==='mouse')hide();
    };
    svg.onblur=hide;
  }

  const chartResizeStates=new WeakMap();

  function responsiveChartWidth(svg,logicalHeight){
    const rect=svg.getBoundingClientRect();
    const cssWidth=rect.width||700;
    const cssHeight=rect.height||logicalHeight;

    // 실제 표시 영역과 같은 가로세로 비율의 viewBox를 사용하여
    // 그래프가 카드 내부 너비를 전부 사용하도록 합니다.
    return Math.max(360,Math.round(cssWidth/cssHeight*logicalHeight));
  }

  function observeResponsiveChart(svg,redraw){
    if(typeof ResizeObserver==='undefined')return;

    let state=chartResizeStates.get(svg);

    if(!state){
      state={
        redraw:null,
        width:Math.round(svg.getBoundingClientRect().width),
        frame:null,
        observer:null
      };

      state.observer=new ResizeObserver(entries=>{
        const width=Math.round(entries[0]?.contentRect?.width||0);

        if(!width||Math.abs(width-state.width)<3)return;

        state.width=width;

        if(state.frame)cancelAnimationFrame(state.frame);
        state.frame=requestAnimationFrame(()=>{
          state.frame=null;
          state.redraw?.();
        });
      });

      state.observer.observe(svg);
      chartResizeStates.set(svg,state);
    }

    state.redraw=redraw;
    state.width=Math.round(svg.getBoundingClientRect().width);
  }

  function lineChart(svg,history,opt){
    const H=230;
    const W=responsiveChartWidth(svg,H);
    const left=48,right=20,top=18,bottom=38;
    const min=opt.min,max=opt.max;
    const plotWidth=W-left-right;
    const plotHeight=H-top-bottom;
    const x=i=>history.length<=1
      ? left+plotWidth/2
      : left+i*plotWidth/(history.length-1);
    const y=v=>top+(max-v)*plotHeight/(max-min);

    const tickCount=4;
    const ticks=Array.from({length:tickCount},(_,i)=>min+(max-min)*i/(tickCount-1));
    const grid=ticks.map(v=>`
      <line class="chart-grid" x1="${left}" x2="${W-right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="chart-axis chart-axis-y" x="${left-8}" y="${y(v)+4}" text-anchor="end">${v.toFixed(2)}</text>
    `).join('');

    const refs=(opt.lines||[]).map(l=>`
      <line
        class="chart-reference ${esc(l.className||'')}"
        x1="${left}" x2="${W-right}"
        y1="${y(l.v)}" y2="${y(l.v)}"
        stroke="${l.color}"
        stroke-width="2.5"
        stroke-dasharray="${l.dash||'8 6'}"
      />
    `).join('');

    const pts=history.map((v,i)=>`${x(i)},${y(v[opt.key])}`).join(' ');
    const labelStep=Math.max(1,Math.ceil(history.length/7));
    const labels=history.map((v,i)=>
      i%labelStep===0||i===history.length-1
        ? `<text class="chart-axis chart-axis-x" text-anchor="middle" x="${x(i)}" y="${H-11}">${esc(v.time)}</text>`
        : ''
    ).join('');

    const dots=history.map((v,i)=>`
      <circle
        cx="${x(i)}"
        cy="${y(v[opt.key])}"
        r="${i===history.length-1?5:2.5}"
        fill="${opt.color}"
      />
    `).join('');

    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    svg.setAttribute('tabindex','0');
    svg.innerHTML=`
      ${grid}
      ${refs}
      <polyline class="chart-line" stroke="${opt.color}" points="${pts}"/>
      ${dots}
      ${labels}
      <g class="chart-hover-layer" style="display:none">
        <line class="chart-hover-line"/>
        <circle class="chart-hover-dot" r="6"/>
      </g>
    `;

    bindChartTooltip(svg,{
      history,left,plotWidth,top,bottomY:H-bottom,x,
      series:[{key:opt.key,y,color:opt.color}],
      format:(row,index)=>{
        const level=Number(row[opt.key]);
        const previous=index>0?Number(history[index-1][opt.key]):null;
        const delta=previous===null?null:level-previous;
        const clearance=cfg.STRUCTURE_HEIGHT_M-level;

        return `<div class="chart-tooltip-time">${esc(dateTimeText(row.timestamp)||row.time)}</div>
          <div class="chart-tooltip-row"><span>잠수교 수위</span><b>${fmt(level,2)}m</b></div>
          <div class="chart-tooltip-row"><span>통과높이</span><b>${fmt(clearance,2)}m</b></div>
          <div class="chart-tooltip-row"><span>10분 전 대비</span><b class="${delta===null?'':deltaClass(delta)}">${delta===null?'-':signed(delta,2,'m')}</b></div>`;
      }
    });

    observeResponsiveChart(svg,()=>lineChart(svg,history,opt));
  }

  function damChart(svg,h){
    const H=220;
    const W=responsiveChartWidth(svg,H);
    const left=46,right=22,top=20,bottom=40;
    const plotWidth=W-left-right;
    const plotHeight=H-top-bottom;
    const max=Math.max(3300,...h.flatMap(v=>[v.inflow,v.outflow]));
    const min=0;
    const x=i=>h.length<=1?left+plotWidth/2:left+i*plotWidth/(h.length-1);
    const y=v=>top+(max-v)*plotHeight/(max-min);

    const grid=[0,1000,2000,3000].map(v=>`
      <line class="chart-grid" x1="${left}" x2="${W-right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="chart-axis chart-axis-y" x="${left-8}" y="${y(v)+4}" text-anchor="end">${v}</text>
    `).join('');

    const ref=`
      <line x1="${left}" x2="${W-right}" y1="${y(2000)}" y2="${y(2000)}" stroke="#d89a16" stroke-width="2.5" stroke-dasharray="11 6"/>
      <line x1="${left}" x2="${W-right}" y1="${y(3000)}" y2="${y(3000)}" stroke="#d43942" stroke-width="2.5" stroke-dasharray="4 4"/>`;

    const inflow=h.map((v,i)=>`${x(i)},${y(v.inflow)}`).join(' ');
    const outflow=h.map((v,i)=>`${x(i)},${y(v.outflow)}`).join(' ');
    const labelStep=Math.max(1,Math.ceil(h.length/7));
    const labels=h.map((v,i)=>
      i%labelStep===0||i===h.length-1
        ? `<text class="chart-axis chart-axis-x" text-anchor="middle" x="${x(i)}" y="${H-11}">${esc(v.time)}</text>`
        : ''
    ).join('');
    const dots=h.map((v,i)=>`
      <circle cx="${x(i)}" cy="${y(v.inflow)}" r="${i===h.length-1?4.5:2.3}" fill="#e77f2f"/>
      <circle cx="${x(i)}" cy="${y(v.outflow)}" r="${i===h.length-1?4.5:2.3}" fill="#2499d8"/>
    `).join('');

    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    svg.setAttribute('tabindex','0');
    svg.innerHTML=`${grid}${ref}
      <polyline class="chart-line" stroke="#e77f2f" points="${inflow}"/>
      <polyline class="chart-line" stroke="#2499d8" points="${outflow}"/>
      ${dots}${labels}
      <g class="chart-hover-layer" style="display:none">
        <line class="chart-hover-line"/>
        <circle class="chart-hover-dot" r="6"/>
        <circle class="chart-hover-dot" r="6"/>
      </g>`;

    bindChartTooltip(svg,{
      history:h,left,plotWidth,top,bottomY:H-bottom,x,
      series:[
        {key:'inflow',y,color:'#e77f2f'},
        {key:'outflow',y,color:'#2499d8'}
      ],
      format:(row,index)=>{
        const previous=index>0?h[index-1]:null;
        const difference=Number(row.inflow)-Number(row.outflow);
        const outflowDelta=previous?Number(row.outflow)-Number(previous.outflow):null;

        return `<div class="chart-tooltip-time">${esc(dateTimeText(row.timestamp)||row.time)}</div>
          <div class="chart-tooltip-row inflow"><span>유입량</span><b>${fmt(row.inflow)}㎥/s</b></div>
          <div class="chart-tooltip-row outflow"><span>방류량</span><b>${fmt(row.outflow)}㎥/s</b></div>
          <div class="chart-tooltip-row"><span>유입-방류</span><b class="${deltaClass(difference)}">${signed(difference,0,'㎥/s')}</b></div>
          <div class="chart-tooltip-row"><span>10분 전 방류 대비</span><b class="${outflowDelta===null?'':deltaClass(outflowDelta)}">${outflowDelta===null?'-':signed(outflowDelta,0,'㎥/s')}</b></div>`;
      }
    });

    observeResponsiveChart(svg,()=>damChart(svg,h));
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
  const DETAIL_PAGE_CONFIG={
    route:{
      eyebrow:'운항판정',
      title:'노선 운항판정 상세',
      description:'동부선·서부선의 현재 운항 가능 여부와 판정에 반영된 핵심 근거를 한 화면에서 확인합니다.',
      cards:[
        ['판정 목적','수문·기상·특보를 종합해 현재 노선별 운항 위험도를 빠르게 확인합니다.'],
        ['확인 항목','잠수교 통과높이, 팔당댐 방류량, 강수·풍속, 운항 관련 특보, 조석 중첩을 함께 봅니다.'],
        ['판정 유의','화면 판정은 참고값입니다. 회사 지침, 선박 상태, 현장 시계·유속과 선장의 판단을 우선합니다.']
      ],
      related:[['jamsu','잠수교 통과높이'],['dam','팔당댐 방류량'],['alerts','운항 관련 특보']]
    },
    jamsu:{
      eyebrow:'수문 핵심지표',
      title:'잠수교 통과높이 상세',
      description:'잠수교 수위가 상승할수록 선박이 통과할 수 있는 여유 높이는 감소합니다.',
      cards:[
        ['핵심 관계','잠수교 통과높이는 기준 구조물 높이에서 관측 수위를 차감해 산정하며 수위와 반대로 움직입니다.'],
        ['확인 항목','현재 통과높이, 10·30·60분 변화, 주의·운항중지 기준과의 여유를 함께 확인합니다.'],
        ['운항 적용','기준 접근 시 잠수교 도달 예상시각의 방류량·조석·수위 추세와 실제 통항 가능 높이를 재확인합니다.']
      ],
      related:[['route','노선 운항판정'],['dam','팔당댐 방류량'],['tide','인천 조석']]
    },
    dam:{
      eyebrow:'상류 수문정보',
      title:'팔당댐 방류량 상세',
      description:'팔당댐 유입량·방류량과 증가 추세를 통해 한강 유속·수위 상승 가능성을 확인합니다.',
      cards:[
        ['핵심 지표','현재 방류량뿐 아니라 10분·30분·1시간 증가폭과 유입량 대비 방류량을 함께 확인합니다.'],
        ['운항 기준','동부선과 서부선의 방류량 기준 접근 여부를 구분하여 표시합니다.'],
        ['시간차 유의','팔당댐 방류 영향은 지점별 도달시간이 다르므로 현재값만으로 하류 수위를 단정하지 않습니다.']
      ],
      related:[['route','노선 운항판정'],['jamsu','잠수교 통과높이'],['river','한강 수위']]
    },
    river:{
      eyebrow:'교량 관측수위',
      title:'한강 수위 상세',
      description:'잠수교와 한강대교 관측수위의 현재값·변화량·갱신상태를 비교합니다.',
      cards:[
        ['확인 목적','한강 주요 관측지점의 수위 상승·하강 방향과 변화 속도를 확인합니다.'],
        ['표시 기준','한강대교는 수위만 표시하며 잠수교처럼 통과높이 값을 적용하지 않습니다.'],
        ['자료 유의','0.00·결측·갱신지연 자료는 운항판단에 사용하지 않고 원자료와 현장을 재확인합니다.']
      ],
      related:[['jamsu','잠수교 통과높이'],['dam','팔당댐 방류량'],['tide','인천 조석']]
    },
    alerts:{
      eyebrow:'공식 기상특보',
      title:'운항 관련 특보 상세',
      description:'서울 및 상류 영향권의 공식 특보 중 운항에 직접 영향을 주는 항목을 분리해 확인합니다.',
      cards:[
        ['표시 범위','호우·강풍·태풍과 폭염 관련 특보를 지역별로 구분해 표시합니다.'],
        ['운항 영향','경보·주의보·예비특보의 단계와 대상지역에 따라 운항중지·사전검토·보호조치를 검토합니다.'],
        ['해석 유의','전국 통보문 제목만 보지 않고 실제 대상지역에 서울 또는 상류 영향권이 포함됐는지 확인합니다.']
      ],
      related:[['route','노선 운항판정'],['rain','강수 예보'],['wind','풍향·풍속']]
    },
    rain:{
      eyebrow:'단기 강수전망',
      title:'강수 예보 상세',
      description:'동부선·서부선 권역별 예상 강수량과 강수 확률을 비교합니다.',
      cards:[
        ['확인 항목','3시간·12시간 예상강수, 강수확률과 시간대별 집중 가능성을 확인합니다.'],
        ['운항 영향','강수량 자체뿐 아니라 시정 저하, 돌풍, 선착장 승하선 안전과 수위 상승 가능성을 함께 봅니다.'],
        ['자료 유의','예보는 변동될 수 있으므로 실제 레이더·현장 시정과 최신 특보를 함께 확인합니다.']
      ],
      related:[['alerts','운항 관련 특보'],['wind','풍향·풍속'],['route','노선 운항판정']]
    },
    wind:{
      eyebrow:'선착장 기상관측',
      title:'풍향·풍속 상세',
      description:'선착장별 현재 풍향·풍속과 단기 예보를 비교해 접·이안 위험을 확인합니다.',
      cards:[
        ['확인 항목','현재 평균풍속, 최대풍속, 풍향과 1·2시간 예보를 선착장별로 비교합니다.'],
        ['운항 영향','횡풍·돌풍은 접·이안, 계류삭 장력, 승강대 간섭과 선체 횡이동 위험을 키울 수 있습니다.'],
        ['현장 우선','관측소 값과 실제 수면 풍황이 다를 수 있으므로 선착장 풍향계·선장 보고를 우선 확인합니다.']
      ],
      related:[['route','노선 운항판정'],['alerts','운항 관련 특보'],['rain','강수 예보']]
    },
    tide:{
      eyebrow:'하류 조석영향',
      title:'인천 조석 상세',
      description:'인천 실측·예측조위와 만조·간조 시각을 통해 한강 하류 수위 중첩 가능성을 확인합니다.',
      cards:[
        ['확인 항목','현재 조위, 다음 만조·간조, 24시간 예측곡선과 향후 30일 조차를 확인합니다.'],
        ['중첩 위험','팔당댐 방류 증가와 만조가 겹치면 잠수교 수위와 선착장 도교 경사가 함께 악화될 수 있습니다.'],
        ['시간차 유의','인천 조석 영향이 한강 각 지점에 도달하는 시간차를 고려해 예상 도달시각을 별도로 판단합니다.']
      ],
      related:[['jamsu','잠수교 통과높이'],['dam','팔당댐 방류량'],['route','노선 운항판정']]
    }
  };

  const DETAIL_SECTION_IDS=['route','jamsu','dam','alerts','rain','wind','river','tide','health'];

  function renderDetailContext(section){
    const context=$('detailPageContext');
    const meta=DETAIL_PAGE_CONFIG[section];

    if(!context||!meta){
      if(context)context.hidden=true;
      return;
    }

    context.hidden=false;
    $('detailPageEyebrow').textContent=meta.eyebrow;
    $('detailPageTitle').textContent=meta.title;
    $('detailPageDescription').textContent=meta.description;
    $('detailContextGrid').innerHTML=meta.cards.map(([title,text])=>`
      <article>
        <span>${esc(title)}</span>
        <p>${esc(text)}</p>
      </article>
    `).join('');
    $('detailRelatedLinks').innerHTML=`<b>관련 상세항목</b>${meta.related.map(([key,label])=>`
      <button type="button" data-detail-related="${key}">${esc(label)}</button>
    `).join('')}`;
  }

  function setDetailPageMode(section=''){
    const normalized=DETAIL_PAGE_CONFIG[section]?section:'';
    const focus=Boolean(normalized);

    document.body.classList.toggle('detail-focus',focus);
    document.body.dataset.detailSection=normalized||'all';
    document.querySelector('.quick-nav')?.toggleAttribute('hidden',focus);

    DETAIL_SECTION_IDS.forEach(id=>{
      const element=document.getElementById(id);
      if(!element)return;
      element.hidden=focus&&id!==normalized;
    });

    renderDetailContext(normalized);

    const meta=DETAIL_PAGE_CONFIG[normalized];
    const title=meta?.title||'한강버스 전체 상세 모니터링';
    const description=meta?.description||'기상·수문·조석·노선별 운항판단을 아래로 스크롤하여 확인합니다.';

    if(!document.body.classList.contains('module-autonomy')){
      const heading=document.querySelector('.brand-copy h1');
      const subtitle=document.querySelector('.header-sub');
      if(heading)heading.textContent=title;
      if(subtitle)subtitle.textContent=description;
      document.title=`${title} | 한강버스`;
    }

    requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'auto'}));
  }

  const DETAIL_PAGE_FILES={
    route:'./route.html?v=92.1',jamsu:'./jamsu.html?v=92.1',dam:'./paldang.html?v=92.1',river:'./river.html?v=92.1',
    alerts:'./alerts.html?v=92.1',rain:'./rain.html?v=92.1',wind:'./wind.html?v=92.1',tide:'./tide.html?v=92.1'
  };

  function requestDetailMode(section=''){
    window.location.href=section?(DETAIL_PAGE_FILES[section]||'./detail.html?v=92.1'):'./detail.html?v=92.1';
  }

  /* v91.9 상세화면은 독립 최상위 페이지로만 운영합니다. */

  $('detailShowAll')?.addEventListener('click',()=>requestDetailMode(''));
  document.addEventListener('click',event=>{
    const related=event.target.closest('[data-detail-related]');
    if(!related)return;
    requestDetailMode(related.dataset.detailRelated||'');
  });

  const initialSection=document.body.dataset.detailSection||String(location.hash||'').replace(/^#/,'');
  setDetailPageMode(initialSection);
  $('refreshBtn')?.addEventListener('click',()=>loadData('manual'));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!sharedCache?.readFresh())loadData('resume');});
  bindWeatherSettings();
  bindHydrologySettings();
  loadData('initial');
  setInterval(()=>{if(cfg.DATA_MODE==='live'||cfg.DATA_MODE==='hybrid')loadData('auto')},AUTO_REFRESH_MS);
})();
