(() => {
  'use strict';

  const parseKst = (value) => {
    const text = String(value || '').trim();
    if (!text) return null;
    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    const withZone = /(?:Z|[+-]\d\d:\d\d)$/.test(normalized)
      ? normalized
      : `${normalized}:00+09:00`;
    const date = new Date(withZone);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const iso = (value) => {
    const date = value instanceof Date ? value : parseKst(value);
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  };

  const num = (value, fallback = null) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  function settings() {
    const cfg = window.HANGANG_OCEAN_CONFIG || {};
    return {
      enabled: cfg.ENABLED !== false,
      proxyBase: String(cfg.PROXY_BASE || '').trim().replace(/\/$/, ''),
      obsCode: String(cfg.OBS_CODE || 'DT_0001').trim()
    };
  }

  function isConfigured() {
    const s = settings();
    return s.enabled && /^https:\/\//i.test(s.proxyBase) && Boolean(s.obsCode);
  }

  function itemText(item, tag) {
    return item.querySelector(tag)?.textContent?.trim() || '';
  }

  function parseXml(text) {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    const parserError = xml.querySelector('parsererror');
    if (parserError) throw new Error('조석 XML 해석 실패');

    const resultCode = xml.querySelector('resultCode')?.textContent?.trim();
    const resultMsg = xml.querySelector('resultMsg')?.textContent?.trim();
    if (resultCode && resultCode !== '00') {
      throw new Error(`${resultMsg || '조석 API 오류'} (${resultCode})`);
    }
    return xml;
  }

  async function fetchXml(kind, params = {}) {
    const s = settings();
    const url = new URL(`${s.proxyBase}/tide/${kind}`);
    url.searchParams.set('obsCode', s.obsCode);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    let response;
    try {
      response = await fetch(url.toString(), { cache: 'no-store' });
    } catch (error) {
      throw new Error(`조석 중계 호출 실패: ${error.message}`);
    }

    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.error || parsed.detail || text;
      } catch (_) {}
      throw new Error(`조석 중계 HTTP ${response.status} · ${String(detail).replace(/\s+/g,' ').slice(0,180)}`);
    }
    return parseXml(text);
  }

  async function fetchJson(path, params = {}) {
    const s = settings();
    const url = new URL(`${s.proxyBase}${path}`);
    url.searchParams.set('obsCode', s.obsCode);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    let response;
    try {
      response = await fetch(url.toString(), { cache: 'no-store' });
    } catch (error) {
      throw new Error(`조석 월간자료 호출 실패: ${error.message}`);
    }

    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.error || parsed.resultMsg || text;
      } catch (_) {}
      throw new Error(
        `조석 월간자료 HTTP ${response.status} · ${
          String(detail).replace(/\s+/g, ' ').slice(0, 180)
        }`
      );
    }

    const parsed = JSON.parse(text);
    if (parsed.ok === false) {
      throw new Error(parsed.error || parsed.resultMsg || '조석 월간자료 오류');
    }
    return parsed;
  }

  function kstDateKey(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);

    const values = Object.fromEntries(
      parts.map(part => [part.type, part.value])
    );

    return `${values.year}${values.month}${values.day}`;
  }

  function addKstDays(date, offset) {
    const shifted = new Date(date.getTime() + offset * 86400000);
    return kstDateKey(shifted);
  }

  function localDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : kstDateKey(date);
  }

  function parseHighLow(xml) {
    return [...xml.querySelectorAll('item')].map(item => {
      const code = num(itemText(item, 'extrSe'), null);
      const heightCm = num(itemText(item, 'predcTdlvVl'), null);
      const time = iso(itemText(item, 'predcDt'));
      let type = null;
      if (code !== null) type = code % 2 === 1 ? 'high' : 'low';
      return { type, code, time, heightCm };
    }).filter(x => x.time && x.heightCm !== null)
      .sort((a,b) => new Date(a.time) - new Date(b.time));
  }

  function parsePrediction(xml) {
    return [...xml.querySelectorAll('item')].map(item => ({
      time: iso(itemText(item, 'predcDt')),
      heightCm: num(itemText(item, 'tdlvHgt'), null)
    })).filter(x => x.time && x.heightCm !== null)
      .sort((a,b) => new Date(a.time) - new Date(b.time));
  }

  function parseSurvey(xml) {
    return [...xml.querySelectorAll('item')].map(item => ({
      time: iso(itemText(item, 'obsrvnDt')),
      observedCm: num(itemText(item, 'bscTdlvHgt'), null),
      predictedCm: num(itemText(item, 'tdlvHgt'), null)
    })).filter(x => x.time)
      .sort((a,b) => new Date(a.time) - new Date(b.time));
  }

  function isPlausibleObservedRow(row) {
    const observed = Number(row?.observedCm);
    const predicted = Number(row?.predictedCm);

    if (!Number.isFinite(observed)) return false;

    // 예측조위가 수백 cm인데 실측이 정확히 0cm로 내려오는 행은
    // 미수신·결측 기본값으로 처리합니다.
    if (
      Math.abs(observed) < 0.05 &&
      Number.isFinite(predicted) &&
      Math.abs(predicted) >= 150
    ) {
      return false;
    }

    // 인천 조위에서 실측·예측 차이가 비정상적으로 큰 행은
    // 운항화면에 실측값으로 표시하지 않습니다.
    if (
      Number.isFinite(predicted) &&
      Math.abs(observed - predicted) > 250
    ) {
      return false;
    }

    return true;
  }

  function latestValidObserved(rows, now) {
    const target = now.getTime();

    return rows.filter(row => {
      const time = new Date(row.time).getTime();
      return Number.isFinite(time) &&
        time <= target &&
        isPlausibleObservedRow(row);
    }).at(-1) || null;
  }

  function nearestAtOrBefore(rows, now, key) {
    const target = now.getTime();
    const valid = rows.filter(row => {
      const t = new Date(row.time).getTime();
      return Number.isFinite(t) && t <= target && Number.isFinite(Number(row[key]));
    });
    return valid.at(-1) || null;
  }

  function nearest(rows, now, key) {
    const target = now.getTime();
    return rows.filter(row => Number.isFinite(Number(row[key])))
      .map(row => ({ row, diff: Math.abs(new Date(row.time).getTime() - target) }))
      .sort((a,b) => a.diff - b.diff)[0]?.row || null;
  }

  function eventAround(events, now, type, direction) {
    const target = now.getTime();
    const filtered = events.filter(e => e.type === type);
    if (direction === 'previous') {
      return filtered.filter(e => new Date(e.time).getTime() <= target).at(-1) || null;
    }
    return filtered.find(e => new Date(e.time).getTime() > target) || null;
  }

  function tenMinuteTimeline(rows) {
    return rows.filter((row, index) => {
      const d = new Date(row.time);
      return d.getMinutes() % 10 === 0 || index === rows.length - 1;
    }).map(row => ({
      time: row.time,
      label: new Date(row.time).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}),
      heightCm: row.heightCm
    }));
  }

  function classifyRange(rangeCm) {
    if (!Number.isFinite(rangeCm)) return '자료 확인';
    if (rangeCm >= 700) return '대조차';
    if (rangeCm >= 400) return '중조차';
    return '소조차';
  }

  function phaseFromSeries(rows, now) {
    if (!rows.length) return '자료 확인';
    const target = now.getTime();
    const before = [...rows].reverse().find(row => new Date(row.time).getTime() <= target - 10*60000);
    const after = rows.find(row => new Date(row.time).getTime() >= target + 10*60000);
    if (!before || !after) return '전환구간';
    const delta = Number(after.heightCm) - Number(before.heightCm);
    if (delta > 1) return '창조';
    if (delta < -1) return '낙조';
    return '정체';
  }

  async function loadTide() {
    const fetchedAt = new Date();
    const yesterdayKey = addKstDays(fetchedAt, -1);
    const todayKey = addKstDays(fetchedAt, 0);
    const tomorrowKey = addKstDays(fetchedAt, 1);

    const monthlyPromise = fetchJson('/tide/monthly', {
      startDate: todayKey,
      days: 30
    }).catch(error => ({
      ok: false,
      error: error.message,
      daily: [],
      summary: null
    }));

    const [
      yesterdayXml,
      todayXml,
      tomorrowXml,
      predictionXml,
      surveyXml,
      monthly
    ] = await Promise.all([
      fetchXml('highlow', { reqDate: yesterdayKey }),
      fetchXml('highlow', { reqDate: todayKey }),
      fetchXml('highlow', { reqDate: tomorrowKey }),
      fetchXml('timeseries'),
      fetchXml('survey'),
      monthlyPromise
    ]);

    const allEvents = [
      ...parseHighLow(yesterdayXml),
      ...parseHighLow(todayXml),
      ...parseHighLow(tomorrowXml)
    ].sort((a, b) => new Date(a.time) - new Date(b.time));

    const events = allEvents.filter(
      event => localDateKey(event.time) === todayKey
    );

    const prediction = parsePrediction(predictionXml);
    const survey = parseSurvey(surveyXml);
    if (!prediction.length) {
      throw new Error('인천 조석예보 시계열 자료 없음');
    }

    const currentObserved = latestValidObserved(survey, fetchedAt);
    const currentPredicted = nearest(prediction, fetchedAt, 'heightCm');
    const observedAgeMinutes = currentObserved
      ? Math.max(
          0,
          Math.round(
            (fetchedAt.getTime() - new Date(currentObserved.time).getTime()) /
            60000
          )
        )
      : null;

    const previousHigh = eventAround(
      allEvents,
      fetchedAt,
      'high',
      'previous'
    );
    const previousLow = eventAround(
      allEvents,
      fetchedAt,
      'low',
      'previous'
    );
    const nextHigh = eventAround(allEvents, fetchedAt, 'high', 'next');
    const nextLow = eventAround(allEvents, fetchedAt, 'low', 'next');

    const highs = events
      .filter(event => event.type === 'high')
      .map(event => event.heightCm);
    const lows = events
      .filter(event => event.type === 'low')
      .map(event => event.heightCm);

    const rangeCm = highs.length && lows.length
      ? Math.max(...highs) - Math.min(...lows)
      : null;

    return {
      referenceAt: fetchedAt.toISOString(),
      updatedAt: fetchedAt.toISOString(),
      stationName: '인천',
      obsCode: settings().obsCode,
      latitude: 37.45194,
      longitude: 126.59222,
      phase: phaseFromSeries(prediction, fetchedAt),
      rangeClass: classifyRange(rangeCm),
      rangeCm,
      overlapRisk: '분석 대기',
      currentObserved: currentObserved ? {
        time: currentObserved.time,
        heightCm: currentObserved.observedCm,
        predictedCm: currentObserved.predictedCm,
        deviationCm:
          currentObserved.observedCm - currentObserved.predictedCm,
        ageMinutes: observedAgeMinutes,
        isCurrent:
          observedAgeMinutes !== null && observedAgeMinutes <= 30
      } : null,
      observedStatus: currentObserved
        ? (observedAgeMinutes <= 30 ? 'current' : 'delayed')
        : 'unavailable',
      currentPredicted: currentPredicted ? {
        time: currentPredicted.time,
        heightCm: currentPredicted.heightCm
      } : null,
      previousHigh,
      previousLow,
      nextHigh,
      nextLow,
      events,
      allEvents,
      timeline: tenMinuteTimeline(prediction),
      monthly,
      monthlyError: monthly?.ok === false ? monthly.error : null,
      intervalMinutes: 1,
      sourceLabel:
        '바다누리·공공데이터포털 인천 조석'
    };
  }

  async function testConnection() {
    const tide = await loadTide();
    return {
      ok: true,
      stationName: tide.stationName,
      observedAt: tide.currentObserved?.time || tide.currentPredicted?.time,
      currentCm: tide.currentObserved?.heightCm ?? tide.currentPredicted?.heightCm,
      nextHigh: tide.nextHigh,
      nextLow: tide.nextLow
    };
  }

  window.OCEAN = { isConfigured, loadTide, testConnection, settings };
})();
