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

  async function fetchXml(kind) {
    const s = settings();
    const url = new URL(`${s.proxyBase}/tide/${kind}`);
    url.searchParams.set('obsCode', s.obsCode);

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
    const [highLowXml, predictionXml, surveyXml] = await Promise.all([
      fetchXml('highlow'),
      fetchXml('timeseries'),
      fetchXml('survey')
    ]);

    const events = parseHighLow(highLowXml);
    const prediction = parsePrediction(predictionXml);
    const survey = parseSurvey(surveyXml);
    if (!prediction.length) throw new Error('인천 조석예보 시계열 자료 없음');

    const currentObserved = nearestAtOrBefore(survey, fetchedAt, 'observedCm');
    const currentPredicted = nearest(prediction, fetchedAt, 'heightCm');
    const previousHigh = eventAround(events, fetchedAt, 'high', 'previous');
    const previousLow = eventAround(events, fetchedAt, 'low', 'previous');
    const nextHigh = eventAround(events, fetchedAt, 'high', 'next');
    const nextLow = eventAround(events, fetchedAt, 'low', 'next');
    const highs = events.filter(e => e.type === 'high').map(e => e.heightCm);
    const lows = events.filter(e => e.type === 'low').map(e => e.heightCm);
    const rangeCm = highs.length && lows.length ? Math.max(...highs) - Math.min(...lows) : null;

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
        deviationCm: currentObserved.observedCm - currentObserved.predictedCm
      } : null,
      currentPredicted: currentPredicted ? {
        time: currentPredicted.time,
        heightCm: currentPredicted.heightCm
      } : null,
      previousHigh,
      previousLow,
      nextHigh,
      nextLow,
      events,
      timeline: tenMinuteTimeline(prediction),
      intervalMinutes: 1,
      sourceLabel: '바다누리·공공데이터포털 인천 조석'
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
