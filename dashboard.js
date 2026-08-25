(() => {
  'use strict';

  const cfg = window.HANGANG_CONFIG;
  const sharedCache = window.HANGANG_DATA_CACHE || null;
  const AUTO_REFRESH_MS = sharedCache?.TTL_MS || 600000;
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

  function tideIsUsable(tide) {
    return Boolean(
      tide &&
      Array.isArray(tide.timeline) && tide.timeline.length >= 2 &&
      (tide.nextHigh || tide.nextLow || (Array.isArray(tide.events) && tide.events.length))
    );
  }

  function renderCachedDashboard(snapshot) {
    if (!snapshot?.data) return false;
    data = structuredClone(snapshot.data);
    previousData = structuredClone(snapshot.data);
    renderDashboard(computeDashboard());
    const age = Math.max(0, Math.round((Date.now() - new Date(snapshot.savedAt).getTime()) / 60000));
    if ($('dashboardMode')) $('dashboardMode').textContent = 'CACHE';
    if ($('dashboardUpdated')) $('dashboardUpdated').textContent = `공유자료 ${age}분 전`;
    const strip = $('dashboardAlertStrip');
    if (strip) {
      strip.textContent = `공유 최신자료 사용 · ${age}분 전 갱신 · 자동 갱신주기 10분`;
      setStateClass(strip, 'normal');
    }
    return true;
  }

  async function loadDashboardData(trigger = 'auto') {
    if (loading) return;
    const force = trigger === 'manual';

    if (!force && sharedCache) {
      const fresh = sharedCache.readFresh();
      if (fresh) {
        renderCachedDashboard(fresh);
        return;
      }

      // 만료된 직전값도 즉시 보여주고, 실제 갱신은 뒤에서 수행합니다.
      const warm = sharedCache.readAny();
      if (warm) renderCachedDashboard(warm);

      if (!sharedCache.acquireLock(false)) {
        if (warm) {
          setTimeout(() => {
            const updated = sharedCache.readAny();
            if (updated && updated.savedAt > warm.savedAt) renderCachedDashboard(updated);
          }, 1800);
          return;
        }

        const arrived = await sharedCache.waitForSnapshot?.(2500);
        if (arrived) {
          renderCachedDashboard(arrived);
          return;
        }

        // 최초 진입에서 스냅샷이 끝내 오지 않으면 빈 화면 방지 차원에서 직접 갱신합니다.
        sharedCache.acquireLock(true);
      }
    } else if (force && sharedCache) {
      sharedCache.acquireLock(true);
    }

    loading = true;

    const refresh = $('dashboardRefresh');
    if (refresh) {
      refresh.disabled = true;
      refresh.textContent = '↻ 불러오는 중';
    }

    const cachedPrevious = sharedCache?.readAny()?.data || null;
    previousData = data ? structuredClone(data) : (cachedPrevious ? structuredClone(cachedPrevious) : null);
    // API 갱신이 시작돼도 기존 카드 값을 비우지 않습니다.
    data = previousData
      ? structuredClone(previousData)
      : structuredClone(
          window.HANGANG_DEMO_DATA?.normal ||
          window.HANGANG_DEMO_DATA?.caution ||
          {}
        );
    data.tide=previousData?.tide||{referenceAt:new Date().toISOString(),updatedAt:null,stationName:'인천',phase:'자료 확인',rangeClass:'자료 확인',rangeCm:null,overlapRisk:'자료 확인',currentObserved:null,currentPredicted:null,previousHigh:null,previousLow:null,nextHigh:null,nextLow:null,events:[],allEvents:[],timeline:[],monthly:{ok:false,daily:[],summary:null},monthlyError:null,sourceLabel:'조석자료 확인 중'};
    data.health=(data.health||[]).filter(item=>!['한강수위','팔당댐','수문정보','기상관측','기상예보','기상특보','조석','조석정보'].includes(item.name));

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
        const tide = await window.OCEAN.loadTide({ force });
        data.health = (data.health || []).filter(
          item => !['조석','조석정보'].includes(item.name)
        );

        if (!tideIsUsable(tide)) {
          throw new Error('예측조위 또는 만·간조 핵심자료 없음');
        }

        data.tide = tide;
        const tideCacheStatus = String(tide.cacheStatus || '');
        const tideStale = tideCacheStatus === 'stale-cache';
        const tideStored = tideCacheStatus === 'daily-cache';
        const tidePartial = tide.monthly?.ok === false;
        data.health.push({
          name:'조석',
          status:tideStale ? 'cached' : tideStored ? 'stored' : tidePartial ? 'partial' : 'normal',
          updatedAt:tide.updatedAt,
          checkedAt:new Date().toISOString(),
          intervalMinutes:360
        });
        liveSources.push(tideStale ? '조석 직전값' : tideStored ? '조석 당일저장' : '조석');
      } catch (error) {
        data.health = (data.health || []).filter(
          item => !['조석','조석정보'].includes(item.name)
        );
        if (tideIsUsable(previousData?.tide)) {
          data.tide = previousData.tide;
          data.health.push({name:'조석',status:'cached',updatedAt:previousData.tide.updatedAt,checkedAt:new Date().toISOString(),intervalMinutes:360,error:error.message});
          liveSources.push('조석 직전값');
        } else {
          data.tide={referenceAt:new Date().toISOString(),updatedAt:null,stationName:'인천',phase:'자료 확인',rangeClass:'자료 확인',rangeCm:null,overlapRisk:'자료 확인',currentObserved:null,currentPredicted:null,previousHigh:null,previousLow:null,nextHigh:null,nextLow:null,events:[],allEvents:[],timeline:[],monthly:{ok:false,daily:[],summary:null},monthlyError:error.message,sourceLabel:'조석자료 미수신'};
          data.health.push({name:'조석',status:'error',updatedAt:null,checkedAt:new Date().toISOString(),intervalMinutes:360,error:error.message});
          errors.push(`조석 ${error.message}`);
        }
      }
    }

    data.meta = data.meta || {};
    data.meta.generatedAt = new Date().toISOString();
    data.meta.mode = liveSources.length ? 'live' : 'check';

    renderDashboard(computeDashboard());

    $('dashboardMode').textContent = liveSources.length ? 'LIVE' : 'CHECK';
    $('dashboardUpdated').textContent =
      `갱신 ${dateTimeText(data.meta.generatedAt)}`;

    const strip = $('dashboardAlertStrip');
    if (errors.length) {
      strip.textContent =
        `일부 데이터 갱신 실패 · ${errors.join(' / ')} · 직전값 또는 미수신 항목 확인`;
      setStateClass(strip, 'caution');
    }

    sharedCache?.write(data,{trigger,errors,liveSources});
    sharedCache?.releaseLock();
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
      outflow >= thresholds.paldang.eastStopCms
    ) {
      east = 'stop';
      reasons.push(
        `동부선 팔당 방류 ${fmt(outflow)}㎥/s · 운항중지 기준 ${fmt(thresholds.paldang.eastStopCms)}㎥/s 이상`
      );
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
      if(
        alert?.scope!=='seoul-direct' ||
        alert?.operationImpact===false
      ) return false;
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

  function routeCard(element, name, state, reasons, routeClass) {
    element.classList.remove('route-east','route-west');
    if (routeClass) element.classList.add(routeClass);
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
          : '잠수교·팔당·기상 정상',
      'route-east'
    );
    routeCard(
      $('dashboardWestRoute'),
      '서부선',
      calc.west,
      calc.west === 'stop'
        ? '팔당·강수·특보기준 확인'
        : calc.west === 'caution'
          ? '주의요인 사전 확인'
          : '팔당·기상·조석 정상',
      'route-west'
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

    const paldangEastMargin = cfg.THRESHOLDS.paldang.eastStopCms - calc.outflow;
    const paldangWestMargin = cfg.THRESHOLDS.paldang.westStopCms - calc.outflow;
    const jamsuMargin = calc.clearance - cfg.THRESHOLDS.jamsu.stopClearanceM;
    const nextHigh = data?.tide?.nextHigh;

    const paldangEastState =
      calc.outflow >= cfg.THRESHOLDS.paldang.eastStopCms
        ? 'stop'
        : calc.outflow >= cfg.THRESHOLDS.paldang.eastCautionCms
          ? 'caution'
          : 'normal';
    const paldangWestState =
      calc.outflow >= cfg.THRESHOLDS.paldang.westStopCms
        ? 'stop'
        : calc.outflow >= cfg.THRESHOLDS.paldang.westCautionCms
          ? 'caution'
          : 'normal';
    const tideState =
      data?.tide?.overlapRisk === '높음'
        ? 'stop'
        : data?.tide?.overlapRisk === '보통'
          ? 'caution'
          : 'normal';

    const stateRank = { normal:0, caution:1, stop:2 };
    const eastHydroState = [calc.jamsuState, paldangEastState]
      .sort((a,b) => stateRank[b] - stateRank[a])[0] || 'normal';
    const westHydroState = paldangWestState;
    const hydroState = [eastHydroState, westHydroState]
      .sort((a,b) => stateRank[b] - stateRank[a])[0] || 'normal';

    let hydroStateLabel = '중단조건 이상 없음';
    if (eastHydroState === 'stop' && westHydroState === 'stop') {
      hydroStateLabel = '전 노선 중단기준 충족';
    } else if (eastHydroState === 'stop') {
      hydroStateLabel = '동부선 중단기준 충족';
    } else if (westHydroState === 'stop') {
      hydroStateLabel = '서부선 중단기준 충족';
    } else if (hydroState === 'caution') {
      hydroStateLabel = '주의구간 접근';
    }

    const impactSummary = $('hydroImpactSummary');
    setStateClass(impactSummary, hydroState);
    $('hydroImpactState').textContent = hydroStateLabel;

    $('hydroImpactText').textContent =
      hydroState === 'stop'
        ? '운항중단 기준 충족 항목이 있습니다.'
        : hydroState === 'caution'
          ? '중단기준에 접근한 항목이 있습니다.'
          : '잠수교·팔당댐 핵심 기준 정상';

    const stateText = state => state === 'stop' ? '중단기준 충족' : state === 'caution' ? '주의' : '미충족';
    const applyDecisionState = (id, state) => {
      const el = $(id);
      if (!el) return;
      el.classList.remove('normal','caution','stop');
      el.classList.add(state);
    };

    applyDecisionState('hydroEastDecision', eastHydroState);
    applyDecisionState('hydroWestDecision', westHydroState);
    $('hydroEastDecisionText').textContent = stateText(eastHydroState);
    $('hydroWestDecisionText').textContent = stateText(westHydroState);
    $('hydroEastDecisionReason').textContent =
      calc.jamsuState === 'stop'
        ? `잠수교 ${fmt(calc.clearance,2)}m · 기준 7.30m 이하`
        : paldangEastState === 'stop'
          ? `팔당 ${fmt(calc.outflow)}㎥/s · 기준 2,000 이상`
          : eastHydroState === 'caution'
            ? '중단기준 접근 · 상세값 확인'
            : `잠수교 +${fmt(Math.max(0,jamsuMargin),2)}m · 팔당 +${fmt(Math.max(0,paldangEastMargin),0)}㎥/s`;
    $('hydroWestDecisionReason').textContent =
      paldangWestState === 'stop'
        ? `팔당 ${fmt(calc.outflow)}㎥/s · 기준 3,000 이상`
        : paldangWestState === 'caution'
          ? '팔당 방류량 서부선 기준 접근'
          : `팔당 기준까지 ${fmt(Math.max(0,paldangWestMargin),0)}㎥/s`;

    const setHydroChip = (id, state, reference = false) => {
      const el = $(id);
      if (!el) return;
      el.className = state;
      if (reference) {
        el.textContent = state === 'stop' ? '조석 영향 높음' : state === 'caution' ? '조석 주의' : '참고';
      } else {
        el.textContent = state === 'stop' ? '기준 충족' : state === 'caution' ? '주의' : '정상';
      }
    };

    setHydroChip('hydroPaldangEastState', paldangEastState);
    setHydroChip('hydroPaldangWestState', paldangWestState);
    setHydroChip('hydroJamsuState', calc.jamsuState);
    setHydroChip('hydroTideState', tideState, true);

    $('hydroPaldangValue').textContent = `${fmt(calc.outflow)}㎥/s`;
    $('hydroPaldangValueWest').textContent = `${fmt(calc.outflow)}㎥/s`;
    $('hydroPaldangTrend').className =
      calc.outflowDelta > 0 ? 'rise' : calc.outflowDelta < 0 ? 'fall' : 'flat';
    $('hydroPaldangTrend').textContent =
      calc.outflowDelta > 0
        ? `▲ 10분 ${signed(calc.outflowDelta,0,'㎥/s')}`
        : calc.outflowDelta < 0
          ? `▼ 10분 ${signed(calc.outflowDelta,0,'㎥/s')}`
          : '― 10분 변화 없음';
    $('hydroPaldangEastMargin').textContent =
      paldangEastMargin >= 0
        ? `${fmt(paldangEastMargin,0)}㎥/s 여유`
        : `${fmt(Math.abs(paldangEastMargin),0)}㎥/s 초과`;
    $('hydroPaldangWestMargin').textContent =
      paldangWestMargin >= 0
        ? `${fmt(paldangWestMargin,0)}㎥/s 여유`
        : `${fmt(Math.abs(paldangWestMargin),0)}㎥/s 초과`;

    $('hydroJamsuValue').textContent = `${fmt(calc.clearance,2)}m`;
    $('hydroJamsuTrend').className =
      calc.clearanceDelta > .004 ? 'rise' : calc.clearanceDelta < -.004 ? 'fall' : 'flat';
    $('hydroJamsuTrend').textContent =
      calc.clearanceDelta > .004
        ? `▲ 10분 ${signed(calc.clearanceDelta,2,'m')} 개선`
        : calc.clearanceDelta < -.004
          ? `▼ 10분 ${signed(calc.clearanceDelta,2,'m')} 감소`
          : '― 10분 보합';
    $('hydroJamsuMargin').textContent =
      jamsuMargin >= 0
        ? `${fmt(jamsuMargin,2)}m 여유`
        : `${fmt(Math.abs(jamsuMargin),2)}m 기준초과`;

    $('hydroTideValue').textContent = nextHigh?.time ? timeText(nextHigh.time) : '-';
    $('hydroTideHeight').textContent =
      nextHigh?.heightCm !== undefined ? `${fmt(nextHigh.heightCm)}cm 예상` : '조석자료 확인';

    let tideCountdown = '만조 영향 확인 중';
    if (nextHigh?.time) {
      const target = new Date(nextHigh.time);
      if (!Number.isNaN(target.getTime())) {
        const diffMin = Math.round((target.getTime() - Date.now()) / 60000);
        if (diffMin > 0) {
          const h = Math.floor(diffMin / 60);
          const m = diffMin % 60;
          tideCountdown = h > 0 ? `만조까지 약 ${h}시간 ${m}분` : `만조까지 약 ${m}분`;
        } else if (diffMin > -90) {
          tideCountdown = '현재 만조 영향 시간대';
        }
      }
    }
    $('hydroTideCountdown').textContent = tideCountdown;

    $('hydroHangangLevel').textContent = `${fmt(data?.hydrology?.hangangBridge?.waterLevelM,2)}m`;
    $('hydroJamsuLevel').textContent = `${fmt(calc.waterLevel,2)}m`;


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
    const important = alerts
      .filter(alert=>alert?.scope==='seoul-direct')
      .slice(0, 3);

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
      const explicitError = item && ['error','missing'].includes(item.status);
      const explicitCached = item?.status === 'cached';
      const explicitStored = item?.status === 'stored';
      const explicitPartial = item?.status === 'partial';
      const state =
        explicitError
          ? 'stop'
          : !item || age === null
            ? 'caution'
            : explicitCached
              ? 'caution'
              : explicitStored
                ? 'normal'
                : explicitPartial
                  ? 'caution'
                  : age > threshold
                ? 'stop'
                : age > Number(item.intervalMinutes || 10) * 1.5
                  ? 'caution'
                  : 'normal';

      return {
        name,
        state,
        text:explicitError ? '자료 미수신' : explicitPartial ? '일부자료 미수신' : age === null ? '확인 필요' : explicitCached ? `직전값 ${age}분 전` : `${age}분 전`
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


  const detailPages = {
    '': {
      eyebrow:'전체 상세 모니터링',
      title:'운항·수문·기상·조석 전체 상세',
      description:'모든 상세 항목을 한 화면에서 아래로 스크롤하여 확인합니다.'
    },
    route:{
      eyebrow:'운항·수문',
      title:'노선 운항판정 상세',
      description:'동부선·서부선 판정 결과와 판정에 반영된 수문·기상·특보 근거를 확인합니다.'
    },
    jamsu:{
      eyebrow:'운항·수문',
      title:'잠수교 통과높이 상세',
      description:'잠수교 수위, 통과 가능 높이, 변화 추이와 운항 기준 여유를 확인합니다.'
    },
    dam:{
      eyebrow:'운항·수문',
      title:'팔당댐 방류량 상세',
      description:'유입량·방류량·증감 추세와 동·서부선 운항 기준 접근 여부를 확인합니다.'
    },
    river:{
      eyebrow:'운항·수문',
      title:'한강 수위 상세',
      description:'잠수교·한강대교 수위와 단기 변화량, 자료 갱신상태를 확인합니다.'
    },
    alerts:{
      eyebrow:'기상·조석',
      title:'운항 관련 특보 상세',
      description:'서울특별시가 대상지역에 명시된 호우·강풍·태풍 특보만 운항판정에 반영합니다.'
    },
    rain:{
      eyebrow:'기상·조석',
      title:'강수 예보 상세',
      description:'동·서부선 권역별 예상 강수량과 강수 확률, 단시간 집중 가능성을 확인합니다.'
    },
    wind:{
      eyebrow:'기상·조석',
      title:'풍향·풍속 상세',
      description:'선착장별 현재 풍향·풍속과 단기 예보를 비교해 접·이안 위험을 확인합니다.'
    },
    tide:{
      eyebrow:'기상·조석',
      title:'인천 조석 상세',
      description:'실측·예측조위, 만조·간조와 팔당댐 방류 중첩 가능성을 확인합니다.'
    }
  };

  // v91.9: 데이터 분석은 독립 HTML 페이지에서 실행합니다.

  $('dashboardRefresh')?.addEventListener('click', () => loadDashboardData('manual'));

  loadDashboardData('initial');
  setInterval(() => loadDashboardData('auto'), AUTO_REFRESH_MS);
})();