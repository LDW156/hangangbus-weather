(() => {
  'use strict';

  const cfg = window.HANGANG_CONFIG;
  const KMA_CFG = cfg.KMA || {};
  const STORAGE_KEY = KMA_CFG.STORAGE_KEY || 'hangangbus_kma_settings_v1';
  const API_BASE = 'https://apihub.kma.go.kr/api/typ02/openApi';

  const STATIONS = [
    { name: '마곡', sector: 'west', nx: 57, ny: 127 },
    { name: '망원', sector: 'west', nx: 58, ny: 126 },
    { name: '여의도', sector: 'west', nx: 59, ny: 126 },
    { name: '압구정', sector: 'east', nx: 61, ny: 126 },
    { name: '옥수', sector: 'east', nx: 61, ny: 126 },
    { name: '서울숲', sector: 'east', nx: 61, ny: 126 },
    { name: '뚝섬', sector: 'east', nx: 61, ny: 126 },
    { name: '잠실', sector: 'east', nx: 62, ny: 126 }
  ];

  function getSharedSettings() {
    const shared = window.HANGANG_WEATHER_CONFIG || {};
    const authKey = String(shared.AUTH_KEY || '').trim();

    if (
      shared.ENABLED !== false &&
      authKey &&
      authKey !== 'PASTE_KMA_AUTH_KEY_HERE'
    ) {
      return { authKey, source: 'shared' };
    }

    return null;
  }

  function getSettings() {
    const shared = getSharedSettings();
    if (shared) return shared;

    try {
      return {
        ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'),
        source: 'local'
      };
    } catch (_) {
      return {};
    }
  }

  function saveSettings(settings) {
    const clean = { authKey: String(settings?.authKey || '').trim() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  }

  function clearSettings() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function isConfigured() {
    return Boolean(getSettings().authKey);
  }

  function kstParts(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  }

  function formatDate(date) {
    const p = kstParts(date);
    return `${p.year}${p.month}${p.day}`;
  }

  function formatTime(date, minuteOverride = null) {
    const p = kstParts(date);
    const minute = minuteOverride === null ? p.minute : String(minuteOverride).padStart(2, '0');
    return `${p.hour}${minute}`;
  }

  function isoFromKma(dateText, timeText) {
    const d = String(dateText || '').replace(/\D/g, '');
    const t = String(timeText || '').replace(/\D/g, '').padStart(4, '0');
    if (d.length !== 8 || t.length < 4) return null;
    return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:00+09:00`;
  }

  function getUltraNowBase(offsetHours = 0) {
    const d = new Date(Date.now() - (50 + offsetHours * 60) * 60000);
    return { date: formatDate(d), time: formatTime(d, 0), dateObj: d };
  }

  function getUltraForecastBase() {
    const d = new Date(Date.now() - 45 * 60000);
    return { date: formatDate(d), time: formatTime(d, 30), dateObj: d };
  }

  function getShortForecastBase() {
    const safe = new Date(Date.now() - 20 * 60000);
    const p = kstParts(safe);
    const hours = [2,5,8,11,14,17,20,23];
    const currentHour = Number(p.hour);
    let baseHour = [...hours].reverse().find(h => h <= currentHour);
    let baseDate = formatDate(safe);
    if (baseHour === undefined) {
      const prev = new Date(safe.getTime() - 24 * 3600000);
      baseDate = formatDate(prev);
      baseHour = 23;
    }
    return { date: baseDate, time: `${String(baseHour).padStart(2,'0')}00` };
  }

  function endpoint(path, params, authKey) {
    const url = new URL(`${API_BASE}/${path}`);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    url.searchParams.set('authKey', authKey);
    return url.toString();
  }

  async function fetchJson(path, params, authKey) {
    const url = endpoint(path, { pageNo: 1, numOfRows: 1000, dataType: 'JSON', ...params }, authKey);
    let res;
    try {
      res = await fetch(url, { method: 'GET', cache: 'no-store' });
    } catch (error) {
      throw new Error(`기상청 직접 호출 실패(CORS 또는 네트워크): ${error.message}`);
    }
    if (!res.ok) throw new Error(`기상청 HTTP ${res.status}`);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      throw new Error(`기상청 JSON 파싱 실패: ${text.slice(0,120)}`);
    }
    const response = json?.response;
    const code = response?.header?.resultCode;
    if (code && code !== '00') {
      throw new Error(`기상청 API 오류 ${code}: ${response?.header?.resultMsg || '알 수 없음'}`);
    }
    return response?.body || {};
  }

  function items(body) {
    const value = body?.items?.item;
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function categoryMap(list, valueKey) {
    const map = {};
    list.forEach(item => {
      if (!item?.category) return;
      map[item.category] = item[valueKey];
    });
    return map;
  }

  function forecastGroups(list) {
    const grouped = new Map();
    list.forEach(item => {
      const iso = isoFromKma(item.fcstDate, item.fcstTime);
      if (!iso) return;
      if (!grouped.has(iso)) grouped.set(iso, { time: iso });
      grouped.get(iso)[item.category] = item.fcstValue;
    });
    return [...grouped.values()].sort((a,b) => new Date(a.time) - new Date(b.time));
  }

  function num(value, fallback = 0) {
    const n = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function parseRain(value) {
    const s = String(value ?? '').trim();
    if (!s || /강수없음|없음/.test(s)) return 0;
    if (/미만/.test(s)) {
      const n = Number(s.match(/[\d.]+/)?.[0]);
      return Number.isFinite(n) ? n / 2 : 0;
    }
    if (/이상/.test(s)) {
      const n = Number(s.match(/[\d.]+/)?.[0]);
      return Number.isFinite(n) ? n : 0;
    }
    if (s.includes('~')) {
      const nums = s.match(/[\d.]+/g)?.map(Number) || [];
      if (nums.length >= 2) return (nums[0] + nums[1]) / 2;
    }
    return num(s, 0);
  }

  function direction16(deg) {
    const names = ['북','북북동','북동','동북동','동','동남동','남동','남남동','남','남남서','남서','서남서','서','서북서','북서','북북서'];
    const n = Number(deg);
    if (!Number.isFinite(n)) return '-';
    return names[Math.round((((n % 360) + 360) % 360) / 22.5) % 16];
  }

  function nearestForecast(list, targetMs) {
    if (!list.length) return null;
    return list.reduce((best, x) => {
      const diff = Math.abs(new Date(x.time).getTime() - targetMs);
      return !best || diff < best.diff ? { item: x, diff } : best;
    }, null)?.item || null;
  }

  async function fetchNowcastForGrid(grid, authKey, offsetHours = 0) {
    const base = getUltraNowBase(offsetHours);
    const body = await fetchJson('VilageFcstInfoService_2.0/getUltraSrtNcst', {
      base_date: base.date, base_time: base.time, nx: grid.nx, ny: grid.ny
    }, authKey);
    const list = items(body);
    if (!list.length) throw new Error(`초단기실황 자료 없음 (${grid.nx},${grid.ny})`);
    const map = categoryMap(list, 'obsrValue');
    const sample = list[0];
    return {
      observedAt: isoFromKma(sample.baseDate || base.date, sample.baseTime || base.time),
      speed: num(map.WSD),
      directionDeg: num(map.VEC),
      direction: direction16(map.VEC),
      rain1h: parseRain(map.RN1),
      humidity: num(map.REH),
      temperature: num(map.T1H),
      precipitationType: map.PTY,
      raw: map
    };
  }

  async function fetchUltraForecastForGrid(grid, authKey) {
    const base = getUltraForecastBase();
    const body = await fetchJson('VilageFcstInfoService_2.0/getUltraSrtFcst', {
      base_date: base.date, base_time: base.time, nx: grid.nx, ny: grid.ny
    }, authKey);
    const list = forecastGroups(items(body));
    if (!list.length) throw new Error(`초단기예보 자료 없음 (${grid.nx},${grid.ny})`);
    return { issuedAt: isoFromKma(base.date, base.time), timeline: list };
  }

  async function fetchShortForecastForGrid(grid, authKey) {
    const base = getShortForecastBase();
    const body = await fetchJson('VilageFcstInfoService_2.0/getVilageFcst', {
      base_date: base.date, base_time: base.time, nx: grid.nx, ny: grid.ny
    }, authKey);
    const list = forecastGroups(items(body));
    if (!list.length) throw new Error(`단기예보 자료 없음 (${grid.nx},${grid.ny})`);
    return { issuedAt: isoFromKma(base.date, base.time), timeline: list };
  }

  async function fetchSituation(authKey) {
    const body = await fetchJson('VilageFcstMsgService/getWthrSituation', {
      pageNo: 1, numOfRows: 10, dataType: 'JSON', stnId: 109
    }, authKey);
    const list = items(body);
    if (!list.length) return { issuedAt: null, alerts: [] };
    const latest = [...list].sort((a,b) => String(b.tmFc || '').localeCompare(String(a.tmFc || '')))[0];
    const issuedAt = parseSituationTime(latest.tmFc);
    const alerts = [];
    const warningText = cleanText(latest.wn);
    const preliminaryText = cleanText(latest.wr);
    if (warningText && !/없음|해당없음/.test(warningText)) {
      alerts.push({
        source: 'official',
        level: warningText.includes('경보') ? 'warning' : 'advisory',
        area: '서울·수도권',
        title: '기상특보 사항',
        message: warningText,
        issuedAt,
        effectiveAt: issuedAt
      });
    }
    if (preliminaryText && !/없음|해당없음/.test(preliminaryText)) {
      alerts.push({
        source: 'preliminary',
        level: 'watch',
        area: '서울·수도권',
        title: '예비특보',
        message: preliminaryText,
        issuedAt,
        effectiveAt: issuedAt
      });
    }
    return { issuedAt, alerts };
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+\n/g, '\n')
      .trim();
  }

  function parseSituationTime(value) {
    const s = String(value || '').replace(/\D/g, '');
    if (s.length >= 12) return isoFromKma(s.slice(0,8), s.slice(8,12));
    if (s.length >= 10) return isoFromKma(s.slice(0,8), `${s.slice(8,10)}00`);
    return null;
  }

  async function loadWeather() {
    const { authKey } = getSettings();
    if (!authKey) throw new Error('기상청 인증키가 등록되지 않았습니다.');

    const unique = [...new Map(STATIONS.map(s => [`${s.nx},${s.ny}`, { nx:s.nx, ny:s.ny }])).values()];
    const currentEntries = await Promise.all(unique.map(async g => [`${g.nx},${g.ny}`, await fetchNowcastForGrid(g, authKey, 0)]));
    const previousEntries = await Promise.all(unique.map(async g => [`${g.nx},${g.ny}`, await fetchNowcastForGrid(g, authKey, 1)]));
    const ultraEntries = await Promise.all(unique.map(async g => [`${g.nx},${g.ny}`, await fetchUltraForecastForGrid(g, authKey)]));
    const currentMap = Object.fromEntries(currentEntries);
    const previousMap = Object.fromEntries(previousEntries);
    const ultraMap = Object.fromEntries(ultraEntries);

    const now = Date.now();
    const windStations = STATIONS.map(st => {
      const key = `${st.nx},${st.ny}`;
      const current = currentMap[key];
      const previous = previousMap[key];
      const ultra = ultraMap[key];
      const f1 = nearestForecast(ultra.timeline, now + 1 * 3600000) || ultra.timeline[0];
      const f3 = nearestForecast(ultra.timeline, now + 3 * 3600000) || ultra.timeline[ultra.timeline.length - 1];
      return {
        name: st.name,
        sector: st.sector,
        observedAt: current.observedAt,
        direction: current.direction,
        speed: current.speed,
        gust: null,
        sourceLabel: '기상청 초단기실황 격자',
        previous10m: null,
        previous1h: {
          time: previous.observedAt,
          direction: previous.direction,
          speed: previous.speed,
          gust: null
        },
        forecast1h: {
          time: f1.time,
          direction: direction16(f1.VEC),
          speed: num(f1.WSD),
          gust: null
        },
        forecast3h: {
          time: f3.time,
          direction: direction16(f3.VEC),
          speed: num(f3.WSD),
          gust: null
        }
      };
    });

    const reps = {
      west: { nx: 59, ny: 126 },
      east: { nx: 62, ny: 126 }
    };
    const rainEntries = await Promise.all(Object.entries(reps).map(async ([sector, grid]) => {
      const key = `${grid.nx},${grid.ny}`;
      const current = currentMap[key] || await fetchNowcastForGrid(grid, authKey, 0);
      const previous = previousMap[key] || await fetchNowcastForGrid(grid, authKey, 1);
      const short = await fetchShortForecastForGrid(grid, authKey);
      return [sector, buildRainfall(current, previous, short)];
    }));

    const situation = await fetchSituation(authKey);
    const observedTimes = windStations.map(x => new Date(x.observedAt).getTime()).filter(Number.isFinite);
    const observedAt = observedTimes.length ? new Date(Math.max(...observedTimes)).toISOString() : new Date().toISOString();
    const forecastIssuedAt = rainEntries.map(([,r]) => r.forecastIssuedAt).filter(Boolean)[0] || new Date().toISOString();

    return {
      weather: {
        windStations,
        rainfall: Object.fromEntries(rainEntries)
      },
      alerts: situation.alerts,
      observedAt,
      forecastIssuedAt,
      fetchedAt: new Date().toISOString(),
      sourceLabel: '기상청 API허브'
    };
  }

  function buildRainfall(current, previous, short) {
    const future = short.timeline
      .filter(x => new Date(x.time).getTime() >= Date.now() - 30 * 60000)
      .slice(0, 24)
      .map(x => ({ time:x.time, label:labelTime(x.time), amount:parseRain(x.PCP), type:'forecast' }));
    const timeline = [
      { time: previous.observedAt, label: labelTime(previous.observedAt), amount: previous.rain1h, type:'observed' },
      { time: current.observedAt, label: labelTime(current.observedAt), amount: current.rain1h, type:'current' },
      ...future.slice(0, 9)
    ];
    const sum = h => future.slice(0,h).reduce((a,x) => a + num(x.amount), 0);
    return {
      observedAt: current.observedAt,
      forecastIssuedAt: short.issuedAt,
      currentRate: current.rain1h,
      next3h: sum(3),
      next6h: sum(6),
      next12h: sum(12),
      next24h: sum(24),
      timeline,
      observationIntervalMinutes: 60,
      forecastIntervalMinutes: 60,
      sourceLabel: '기상청 초단기실황·단기예보'
    };
  }

  function labelTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('ko-KR', { timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit', hour12:false });
  }

  async function testConnection(authKey) {
    const key = String(authKey || '').trim();
    if (!key) throw new Error('기상청 인증키를 입력하십시오.');
    const test = await fetchNowcastForGrid({ nx: 60, ny: 127 }, key, 0);
    const situation = await fetchSituation(key);
    return {
      ok: true,
      observedAt: test.observedAt,
      speed: test.speed,
      direction: test.direction,
      rain1h: test.rain1h,
      alertCount: situation.alerts.length
    };
  }

  window.KMA = {
    getSettings, saveSettings, clearSettings, isConfigured,
    testConnection, loadWeather, stations: STATIONS.slice()
  };
})();
