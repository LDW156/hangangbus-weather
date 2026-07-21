(() => {
  'use strict';

  const cfg = window.HANGANG_CONFIG;
  const $ = id => document.getElementById(id);
  const fmt = (value, digits = 0) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? number.toLocaleString('ko-KR', {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits
        })
      : '-';
  };
  const timeText = value => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleTimeString('ko-KR', {
          hour:'2-digit',
          minute:'2-digit',
          hour12:false
        })
      : '-';
  };
  const dateTimeText = value => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleString('ko-KR', {
          month:'2-digit',
          day:'2-digit',
          hour:'2-digit',
          minute:'2-digit',
          hour12:false
        })
      : '-';
  };
  const signed = (value, digits = 2, unit = '') => {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    return `${number > 0 ? '+' : ''}${fmt(number, digits)}${unit}`;
  };
  const last = array => array?.[array.length - 1] || {};
  const historyValue = (history, steps, key = 'value') => {
    if (!Array.isArray(history) || !history.length) return null;
    const index = Math.max(0, history.length - 1 - steps);
    const value = Number(history[index]?.[key]);
    return Number.isFinite(value) ? value : null;
  };

  const statusLabels = {
    normal:'정상 운항',
    caution:'주의 운항',
    stop:'운항중지'
  };

  let data = null;
  let previousData = null;
  let loading = false;

  function stateClass(state) {
    return state === 'stop'
      ? 'red'
      : state === 'caution'
        ? 'yellow'
        : 'blue';
  }

  function setStateClass(element, state) {
    if (!element) return;
    element.classList.remove('blue', 'yellow', 'red');
    element.classList.add(stateClass(state));
  }

  async function loadDashboardData() {
    if (loading) return;
    loading = true;

    const refresh = $('dashboardRefresh');
    if (refresh) {
      refresh.disabled = true;
      refresh.textContent = '↻ 불러오는 중';
    }

    previousData = data ? structuredClone(data) : null;
    data = structuredClone(
      window.HANGANG_DEMO_DATA?.normal ||
      window.HANGANG_DEMO_DATA?.caution ||
      {}
    );

    const liveSources = [];
    const errors = [];

    if (cfg?.HRFCO?.ENABLED && window.HRFCO?.isConfigured?.()) {
      try {
        const live = await window.HRFCO.loadHydrology();
        data.hydrology = {
          paldang:live.paldang,
          jamsuBridge:live.jamsuBridge,
          hangangBridge:live.hangangBridge
        };
        data.health = (data.health || []).filter(
          item => !['한강수위','팔당댐','수문정보'].includes(item.name)
        );
        data.health.unshift(
          {
            name:'한강수위',
            status:'normal',
            updatedAt:live.jamsuBridge.observedAt,
            checkedAt:live.fetchedAt,
            intervalMinutes:10
          },
          {
            name:'팔당댐',
            status:'normal',
            updatedAt:live.paldang.observedAt,
            checkedAt:live.fetchedAt,
            intervalMinutes:10
          }
        );
        liveSources.push('수문');
      } catch (error) {
        if (previousData?.hydrology) {
          data.hydrology = previousData.hydrology;
          liveSources.push('수문 직전값');
        } else {
          errors.push(`수문 ${error.message}`);
        }
      }
    }

    if (cfg?.KMA?.ENABLED && window.KMA?.isConfigured?.()) {
      try {
        const live = await window.KMA.loadWeather();
        data.weather = live.weather;
        data.alerts = live.alerts;
        data.alertReleases = live.alertReleases || [];
        data.alertStatus = live.alertStatus;
        data.health = (data.health || []).filter(
          item => !['기상관측','기상예보','기상특보'].includes(item.name)
        );
        data.health.push(
          {
            name:'기상관측',
            status:'normal',
            updatedAt:live.observedAt,
            checkedAt:live.fetchedAt,
            intervalMinutes:60
          },
          {
            name:'기상예보',
            status:'normal',
            updatedAt:live.forecastIssuedAt,
            checkedAt:live.fetchedAt,
            intervalMinutes:60
          },
          {
            name:'기상특보',
            status:'normal',
            updatedAt:live.fetchedAt,
            checkedAt:live.fetchedAt,
            intervalMinutes:10
          }
        );
        liveSources.push('기상');
      } catch (error) {
        if (previousData?.weather) {
          data.weather = previousData.weather;
          data.alerts = previousData.alerts || [];
          data.alertReleases = previousData.alertReleases || [];
          data.alertStatus = previousData.alertStatus;
          liveSources.push('기상 직전값');
        } else {
          errors.push(`기상 ${error.message}`);
        }
      }
    }

    if (cfg?.OCEAN?.ENABLED && window.OCEAN?.isConfigured?.()) {
      try {
        const tide = await window.OCEAN.loadTide();
        data.tide = tide;
        data.health = (data.health || []).filter(
          item => !['조석','조석정보'].includes(item.name)
        );
        data.health.push({
          name:'조석',
          status:'normal',
          updatedAt:tide.updatedAt,
          checkedAt:tide.updatedAt,
          intervalMinutes:10
        });
        liveSources.push('조석');
      } catch (error) {
        if (previousData?.tide) {
          data.tide = previousData.tide;
          liveSources.push('조석 직전값');
        } else {
          errors.push(`조석 ${error.message}`);
        }
      }
    }

    data.meta = data.meta || {};
    data.meta.generatedAt = new Date().toISOString();
    data.meta.mode = liveSources.length ? 'hybrid' : 'demo';

    renderDashboard(computeDashboard());

    $('dashboardMode').textContent = liveSources.length ? 'LIVE' : 'DEMO';
    $('dashboardUpdated').textContent =
      `갱신 ${dateTimeText(data.meta.generatedAt)}`;

    const strip = $('dashboardAlertStrip');
    if (errors.length) {
      strip.textContent =
        `일부 데이터 갱신 실패 · ${errors.join(' / ')} · 직전값 또는 데모값 확인`;
      setStateClass(strip, 'caution');
    }

    loading = false;
    if (refresh) {
      refresh.disabled = false;
      refresh.textContent = '↻ 최신 데이터';
    }

    scheduleDetailPreload();
  }

  function computeDashboard() {
    const thresholds = cfg.THRESHOLDS;
    const jamsu = data?.hydrology?.jamsuBridge || {};
    const paldang = data?.hydrology?.paldang || {};
    const waterLevel = Number(jamsu.waterLevelM) || 0;
    const clearance = Number(cfg.STRUCTURE_HEIGHT_M) - waterLevel;
    const outflow = Number(paldang.outflowCms) || 0;
    const outflowHistory = paldang.history || [];
    const previousOutflow = historyValue(outflowHistory, 1, 'outflow');
    const outflowDelta =
      previousOutflow === null ? 0 : outflow - previousOutflow;
    const priorLevel = historyValue(jamsu.history || [], 1, 'value');
    const priorClearance =
      priorLevel === null
        ? clearance
        : Number(cfg.STRUCTURE_HEIGHT_M) - priorLevel;
    const clearanceDelta = clearance - priorClearance;

    let jamsuState = 'normal';
    if (
      clearance <= thresholds.jamsu.stopClearanceM ||
      waterLevel >= thresholds.jamsu.stopLevelM
    ) {
      jamsuState = 'stop';
    } else if (
      clearance <= thresholds.jamsu.cautionClearanceM ||
      waterLevel >= thresholds.jamsu.cautionLevelM
    ) {
      jamsuState = 'caution';
    }

    let east = jamsuState;
    let west = 'normal';
    const reasons = [];

    const rising =
      outflowHistory.length > 1 &&
      Number(last(outflowHistory).outflow) >
      Number(outflowHistory[Math.max(0, outflowHistory.length - 7)]?.outflow);

    if (
      outflow >= thresholds.paldang.eastStopCms &&
      rising
    ) {
      east = 'stop';
      reasons.push(`동부선 팔당 방류 ${fmt(outflow)}㎥/s 증가`);
    } else if (outflow >= thresholds.paldang.eastCautionCms) {
      if (east === 'normal') east = 'caution';
      reasons.push(`동부선 팔당 방류 기준 접근`);
    }

    if (outflow >= thresholds.paldang.westStopCms) {
      west = 'stop';
      reasons.push(`서부선 팔당 방류 ${fmt(outflow)}㎥/s`);
    } else if (outflow >= thresholds.paldang.westCautionCms) {
      west = 'caution';
      reasons.push(`서부선 팔당 방류 기준 접근`);
    }

    const windStations = data?.weather?.windStations || [];
    const maxWind = sector => {
      const values = windStations
        .filter(item => item.sector === sector)
        .map(item => Number(item.speed))
        .filter(Number.isFinite);
      return values.length ? Math.max(...values) : 0;
    };
    const eastWind = maxWind('east');
    const westWind = maxWind('west');

    const applyWind = (state, value) => {
      if (value >= thresholds.wind.stopMs) return 'stop';
      if (value >= thresholds.wind.cautionMs && state === 'normal') {
        return 'caution';
      }
      return state;
    };
    east = applyWind(east, eastWind);
    west = applyWind(west, westWind);

    const eastRain = data?.weather?.rainfall?.east || {};
    const westRain = data?.weather?.rainfall?.west || {};
    const rainStop3 = Number(thresholds.rainfall?.stop3hMm ?? 90);
    const rainStop12 = Number(thresholds.rainfall?.stop12hMm ?? 180);

    const applyRain = (state, rain) => {
      if (
        Number(rain.next3h) >= rainStop3 ||
        Number(rain.next12h) >= rainStop12
      ) {
        return 'stop';
      }
      if (
        rain.next3hReliable === false ||
        rain.next12hReliable === false
      ) {
        return state === 'normal' ? 'caution' : state;
      }
      return state;
    };
    east = applyRain(east, eastRain);
    west = applyRain(west, westRain);

    const importantAlerts = (data.alerts || []).filter(alert => {
      const text = `${alert.title || ''} ${alert.message || ''}`;
      return ['호우','강풍','태풍'].some(type => text.includes(type));
    });

    const directOfficial = importantAlerts.filter(
      alert =>
        alert.scope === 'seoul-direct' &&
        alert.source === 'official'
    );
    const directPreliminary = importantAlerts.filter(
      alert =>
        alert.scope === 'seoul-direct' &&
        alert.source === 'preliminary'
    );

    const stopKeywords =
      thresholds.alerts?.stopKeywords ||
      ['호우경보','강풍주의보','강풍경보','태풍주의보','태풍경보'];

    const stopAlert = directOfficial.some(alert => {
      const text = `${alert.title || ''} ${alert.message || ''}`
        .replace(/\s+/g, '');
      return stopKeywords.some(keyword =>
        text.includes(String(keyword).replace(/\s+/g, ''))
      );
    });

    if (stopAlert) {
      east = 'stop';
      west = 'stop';
    } else if (directOfficial.length || directPreliminary.length) {
      if (east === 'normal') east = 'caution';
      if (west === 'normal') west = 'caution';
    }

    return {
      east,
      west,
      jamsuState,
      clearance,
      clearanceDelta,
      waterLevel,
      outflow,
      outflowDelta,
      eastWind,
      westWind,
      eastRain,
      westRain,
      importantAlerts,
      reasons,
      stopAlert
    };
  }

  function routeCard(element, name, state, reasons) {
    setStateClass(element, state);
    element.innerHTML = `
      <div>
        <span>${name}</span>
        <b>${statusLabels[state]}</b>
      </div>
      <i>${state === 'stop' ? '중지' : state === 'caution' ? '주의' : '정상'}</i>
      <em>${reasons || '운항기준 정상 범위'}</em>
    `;
  }

  function metricState(value, caution, stop) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'caution';
    if (number >= stop) return 'stop';
    if (number >= caution) return 'caution';
    return 'normal';
  }

  function renderDashboard(calc) {
    routeCard(
      $('dashboardEastRoute'),
      '동부선',
      calc.east,
      calc.east === 'stop'
        ? '잠수교·팔당·기상기준 확인'
        : calc.east === 'caution'
          ? '주의요인 사전 확인'
          : '잠수교·팔당·기상 정상'
    );
    routeCard(
      $('dashboardWestRoute'),
      '서부선',
      calc.west,
      calc.west === 'stop'
        ? '팔당·강수·특보기준 확인'
        : calc.west === 'caution'
          ? '주의요인 사전 확인'
          : '팔당·기상·조석 정상'
    );

    const overall =
      calc.east === 'stop' || calc.west === 'stop'
        ? 'stop'
        : calc.east === 'caution' || calc.west === 'caution'
          ? 'caution'
          : 'normal';

    const strip = $('dashboardAlertStrip');
    setStateClass(strip, overall);
    strip.textContent =
      overall === 'stop'
        ? '운항중지 기준 충족 · 노선별 상세판정과 현장상황을 즉시 확인하십시오.'
        : overall === 'caution'
          ? '주의요인 발생 · 출항 전 수문·기상·특보를 재확인하십시오.'
          : '현재 주요 운항기준 정상 범위입니다.';

    $('dashboardRouteReasons').innerHTML = [
      `잠수교 통과높이 ${fmt(calc.clearance, 2)}m`,
      `팔당 방류 ${fmt(calc.outflow)}㎥/s`,
      `마곡 3시간 ${calc.westRain.next3hDisplay || fmt(calc.westRain.next3h, 1)}mm`,
      `잠실 3시간 ${calc.eastRain.next3hDisplay || fmt(calc.eastRain.next3h, 1)}mm`
    ].map(text => `<span>${text}</span>`).join('');

    $('dashClearance').textContent = `${fmt(calc.clearance, 2)}m`;
    $('dashClearanceTrend').className =
      calc.clearanceDelta > .004
        ? 'rise'
        : calc.clearanceDelta < -.004
          ? 'fall'
          : 'flat';
    $('dashClearanceTrend').textContent =
      calc.clearanceDelta > .004
        ? `▲ ${signed(calc.clearanceDelta, 2, 'm')} 상승`
        : calc.clearanceDelta < -.004
          ? `▼ ${signed(calc.clearanceDelta, 2, 'm')} 하락`
          : '― 0.00m 보합';

    $('dashOutflow').textContent = `${fmt(calc.outflow)}㎥/s`;
    $('dashOutflowTrend').className =
      calc.outflowDelta > 0 ? 'rise' : calc.outflowDelta < 0 ? 'fall' : 'flat';
    $('dashOutflowTrend').textContent =
      calc.outflowDelta > 0
        ? `▲ ${signed(calc.outflowDelta, 0, '㎥/s')}`
        : calc.outflowDelta < 0
          ? `▼ ${signed(calc.outflowDelta, 0, '㎥/s')}`
          : '― 변화 없음';

    const nextHigh = data?.tide?.nextHigh;
    $('dashNextHigh').textContent = nextHigh?.time
      ? dateTimeText(nextHigh.time)
      : '-';
    $('dashNextHighHeight').textContent =
      nextHigh?.heightCm !== undefined
        ? `${fmt(nextHigh.heightCm)}cm`
        : '조석자료 확인';

    $('dashPaldang').textContent = `${fmt(calc.outflow)}㎥/s`;
    $('dashJamsu').textContent = `${fmt(calc.clearance, 2)}m`;
    $('dashHangang').textContent =
      `${fmt(data?.hydrology?.hangangBridge?.waterLevelM, 2)}m`;
    $('dashJamsilRain').textContent =
      `${calc.eastRain.next3hDisplay || fmt(calc.eastRain.next3h, 1)}mm`;
    $('dashMagokRain').textContent =
      `${calc.westRain.next3hDisplay || fmt(calc.westRain.next3h, 1)}mm`;
    $('dashTide').textContent = nextHigh?.time
      ? `${timeText(nextHigh.time)} 만조`
      : '-';

    setStateClass(
      $('nodePaldang'),
      calc.outflow >= cfg.THRESHOLDS.paldang.westStopCms
        ? 'stop'
        : calc.outflow >= cfg.THRESHOLDS.paldang.eastCautionCms
          ? 'caution'
          : 'normal'
    );
    setStateClass($('nodeJamsu'), calc.jamsuState);
    setStateClass(
      $('nodeJamsil'),
      metricState(
        calc.eastRain.next3h,
        cfg.THRESHOLDS.rainfall.stop3hMm * .65,
        cfg.THRESHOLDS.rainfall.stop3hMm
      )
    );
    setStateClass(
      $('nodeMagok'),
      metricState(
        calc.westRain.next3h,
        cfg.THRESHOLDS.rainfall.stop3hMm * .65,
        cfg.THRESHOLDS.rainfall.stop3hMm
      )
    );
    setStateClass($('nodeYeouido'), calc.west);
    setStateClass(
      $('nodeIncheon'),
      data?.tide?.overlapRisk === '높음'
        ? 'stop'
        : data?.tide?.overlapRisk === '보통'
          ? 'caution'
          : 'normal'
    );

    renderWeatherKpi(
      $('westRainKpi'),
      `${calc.westRain.next3hDisplay || fmt(calc.westRain.next3h, 1)}mm`,
      metricState(
        calc.westRain.next3h,
        cfg.THRESHOLDS.rainfall.stop3hMm * .65,
        cfg.THRESHOLDS.rainfall.stop3hMm
      )
    );
    renderWeatherKpi(
      $('eastRainKpi'),
      `${calc.eastRain.next3hDisplay || fmt(calc.eastRain.next3h, 1)}mm`,
      metricState(
        calc.eastRain.next3h,
        cfg.THRESHOLDS.rainfall.stop3hMm * .65,
        cfg.THRESHOLDS.rainfall.stop3hMm
      )
    );
    renderWeatherKpi(
      $('westWindKpi'),
      `${fmt(calc.westWind, 1)}m/s`,
      metricState(
        calc.westWind,
        cfg.THRESHOLDS.wind.cautionMs,
        cfg.THRESHOLDS.wind.stopMs
      )
    );
    renderWeatherKpi(
      $('eastWindKpi'),
      `${fmt(calc.eastWind, 1)}m/s`,
      metricState(
        calc.eastWind,
        cfg.THRESHOLDS.wind.cautionMs,
        cfg.THRESHOLDS.wind.stopMs
      )
    );

    renderAlerts(calc.importantAlerts);
    renderEvents(calc);
    renderHealth();
  }

  function renderWeatherKpi(element, value, state) {
    setStateClass(element, state);
    element.querySelector('b').textContent = value;
  }

  function renderAlerts(alerts) {
    const root = $('dashboardAlertList');
    const important = alerts.slice(0, 3);

    if (!important.length) {
      root.innerHTML = `
        <div class="dashboard-alert-empty blue">
          <b>운항 관련 특보 없음</b>
          <span>서울 호우·강풍·태풍 기준</span>
        </div>
      `;
      return;
    }

    root.innerHTML = important.map(alert => {
      const text = `${alert.title || ''} ${alert.message || ''}`;
      const state =
        /경보|강풍주의보|태풍주의보/.test(text)
          ? 'red'
          : 'yellow';
      return `
        <div class="dashboard-alert-item ${state}">
          <i></i>
          <div>
            <b>${alert.title || '공식 기상특보'}</b>
            <span>${alert.area || '상세지역 확인'} · 발표 ${dateTimeText(alert.issuedAt)}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderEvents(calc) {
    $('dashboardEventTime').textContent =
      dateTimeText(data?.meta?.generatedAt);

    const events = [];
    const add = (state, title, detail) => events.push({state, title, detail});

    add(
      calc.clearance <= cfg.THRESHOLDS.jamsu.stopClearanceM
        ? 'red'
        : calc.clearance <= cfg.THRESHOLDS.jamsu.cautionClearanceM
          ? 'yellow'
          : 'blue',
      '잠수교 통과높이',
      `${fmt(calc.clearance, 2)}m · ${
        calc.clearanceDelta > .004
          ? `10분 전 대비 ${signed(calc.clearanceDelta, 2, 'm')} 상승`
          : calc.clearanceDelta < -.004
            ? `10분 전 대비 ${signed(calc.clearanceDelta, 2, 'm')} 하락`
            : '10분 전 대비 보합'
      }`
    );

    add(
      calc.outflow >= cfg.THRESHOLDS.paldang.westStopCms
        ? 'red'
        : calc.outflow >= cfg.THRESHOLDS.paldang.eastCautionCms
          ? 'yellow'
          : 'blue',
      '팔당댐 방류량',
      `${fmt(calc.outflow)}㎥/s · 10분 전 대비 ${signed(calc.outflowDelta, 0, '㎥/s')}`
    );

    add(
      calc.eastRain.next12h >= cfg.THRESHOLDS.rainfall.stop12hMm
        ? 'red'
        : calc.eastRain.next12h >= cfg.THRESHOLDS.rainfall.stop12hMm * .65
          ? 'yellow'
          : 'blue',
      '잠실 강수 전망',
      `12시간 ${calc.eastRain.next12hDisplay || fmt(calc.eastRain.next12h, 1)}mm`
    );

    const nextHigh = data?.tide?.nextHigh;
    if (nextHigh) {
      add(
        data?.tide?.overlapRisk === '높음'
          ? 'red'
          : data?.tide?.overlapRisk === '보통'
            ? 'yellow'
            : 'blue',
        '인천 다음 만조',
        `${dateTimeText(nextHigh.time)} · ${fmt(nextHigh.heightCm)}cm`
      );
    }

    $('dashboardEventList').innerHTML = events.slice(0, 4).map(event => `
      <div class="dashboard-event-item ${event.state}">
        <i></i>
        <div>
          <b>${event.title}</b>
          <span>${event.detail}</span>
        </div>
      </div>
    `).join('');
  }

  function renderHealth() {
    const root = $('dashboardHealth');
    const important = ['한강수위','팔당댐','기상관측','기상예보','기상특보','조석'];
    const rows = important.map(name => {
      const item = (data.health || []).find(health => health.name === name);
      const age = item?.updatedAt
        ? Math.max(0, Math.round((Date.now() - new Date(item.updatedAt)) / 60000))
        : null;
      const threshold = Number(item?.intervalMinutes || 10) * 3;
      const state =
        !item || age === null
          ? 'caution'
          : age > threshold
            ? 'stop'
            : age > Number(item.intervalMinutes || 10) * 1.5
              ? 'caution'
              : 'normal';

      return {
        name,
        state,
        text:age === null ? '확인 필요' : `${age}분 전`
      };
    });

    root.innerHTML = rows.map(row => `
      <div class="health-row ${stateClass(row.state)}">
        <i></i>
        <span>${row.name}</span>
        <b>${row.text}</b>
      </div>
    `).join('');
  }


  const detailTitles = {
    '':'전체 상세화면',
    route:'노선 운항판정',
    jamsu:'잠수교 통과높이',
    dam:'팔당댐 방류량',
    river:'한강 수위',
    alerts:'운항 관련 기상특보',
    rain:'강수 예보',
    wind:'풍향·풍속',
    tide:'인천 조석'
  };

  let detailFrameLoaded=false;
  let detailFrameLoading=false;
  let pendingDetailSection='';
  let detailPreloadScheduled=false;

  function activateMenu(link){
    document.querySelectorAll('.side-nav a').forEach(item=>{
      item.classList.toggle('active',item===link);
    });
  }

  function detailMessage(payload){
    const frame=$('detailFrame');
    if(!detailFrameLoaded||!frame?.contentWindow)return;
    frame.contentWindow.postMessage(payload,window.location.origin);
  }

  function pushDashboardDataToDetail(){
    if(!data)return;
    detailMessage({
      type:'hangangbus-prefill-data',
      data
    });
  }

  function scrollDetail(section=''){
    pendingDetailSection=section;
    if(!detailFrameLoaded)return;
    detailMessage({
      type:'hangangbus-scroll-section',
      section
    });
  }

  function setDetailLoading(visible){
    const overlay=$('detailLoadingOverlay');
    if(!overlay)return;
    overlay.hidden=!visible;
  }

  function ensureDetailFrame(){
    const frame=$('detailFrame');
    if(!frame||detailFrameLoaded||detailFrameLoading)return;

    detailFrameLoading=true;
    const source=frame.dataset.src||'./detail.html?v=88';
    frame.setAttribute('src',source);
  }

  function scheduleDetailPreload(){
    if(detailPreloadScheduled||detailFrameLoaded||detailFrameLoading)return;
    detailPreloadScheduled=true;

    const preload=()=>ensureDetailFrame();

    if('requestIdleCallback' in window){
      requestIdleCallback(preload,{timeout:1800});
    }else{
      setTimeout(preload,900);
    }
  }

  function showDashboard(link=null){
    $('dashboardView').classList.add('active');
    $('detailView').classList.remove('active');
    $('detailView').setAttribute('aria-hidden','true');

    activateMenu(
      link || document.querySelector('.side-nav a[href="./index.html"]')
    );

    sessionStorage.setItem('hangangbus-view','dashboard');
  }

  function showDetail(section='',link=null){
    $('dashboardView').classList.remove('active');
    $('detailView').classList.add('active');
    $('detailView').setAttribute('aria-hidden','false');
    $('detailViewTitle').textContent=detailTitles[section]||'상세 모니터링';

    pendingDetailSection=section;
    setDetailLoading(!detailFrameLoaded);
    ensureDetailFrame();

    if(detailFrameLoaded){
      pushDashboardDataToDetail();
      scrollDetail(section);
    }

    if(link)activateMenu(link);

    sessionStorage.setItem(
      'hangangbus-view',
      JSON.stringify({view:'detail',section})
    );
  }

  const detailFrame=$('detailFrame');
  detailFrame?.addEventListener('load',()=>{
    const current=detailFrame.getAttribute('src')||'';
    if(!current.includes('detail.html'))return;

    detailFrameLoading=false;
    detailFrameLoaded=true;
    setDetailLoading(false);
    pushDashboardDataToDetail();
    scrollDetail(pendingDetailSection);
  });

  window.addEventListener('message',event=>{
    if(event.origin!==window.location.origin)return;
    const message=event.data||{};

    if(message.type==='hangangbus-detail-ready'){
      detailFrameLoaded=true;
      detailFrameLoading=false;
      setDetailLoading(false);
      pushDashboardDataToDetail();
      scrollDetail(pendingDetailSection);
    }

    if(message.type==='hangangbus-open-dashboard'){
      showDashboard();
    }
  });

  document.querySelectorAll('.side-nav a').forEach(link=>{
    const href=link.getAttribute('href')||'';

    if(href==='#'||link.classList.contains('disabled'))return;

    link.addEventListener('click',event=>{
      if(href.includes('detail.html')){
        event.preventDefault();
        const section=href.includes('#')?href.split('#')[1]:'';
        showDetail(section,link);
      }else if(href.includes('index.html')){
        event.preventDefault();
        showDashboard(link);
      }
    });
  });

  document.querySelectorAll('a[href^="./detail.html"]').forEach(link=>{
    if(link.closest('.side-nav'))return;

    link.addEventListener('click',event=>{
      event.preventDefault();
      const href=link.getAttribute('href')||'';
      const section=href.includes('#')?href.split('#')[1]:'';
      const menuLink=document.querySelector(
        `.side-nav a[href="./detail.html${section?`#${section}`:''}"]`
      );
      showDetail(section,menuLink);
    });
  });

  $('backToDashboard')?.addEventListener('click',()=>showDashboard());

  try{
    const saved=sessionStorage.getItem('hangangbus-view');
    if(saved&&saved!=='dashboard'){
      const state=JSON.parse(saved);
      if(state?.view==='detail'){
        const section=state.section||'';
        const menuLink=document.querySelector(
          `.side-nav a[href="./detail.html${section?`#${section}`:''}"]`
        );
        showDetail(section,menuLink);
      }
    }
  }catch(_){}

  $('dashboardRefresh')?.addEventListener('click', loadDashboardData);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./service-worker.js')
        .catch(() => {});
    });
  }

  loadDashboardData();
  setInterval(loadDashboardData, cfg?.REFRESH_MS || 300000);
})();