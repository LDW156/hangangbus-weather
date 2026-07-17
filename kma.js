(() => {
  'use strict';

  const cfg = window.HANGANG_CONFIG;
  const KMA_CFG = cfg.KMA || {};
  const STORAGE_KEY = KMA_CFG.STORAGE_KEY || 'hangangbus_kma_settings_v1';

  const ASOS_REFERENCE = { stn: 108, name: '서울 ASOS(108)' };

  /*
   * lat/lon은 기상청 격자 중심을 위·경도로 역변환한
   * 실제 예보 기준좌표입니다. 화면에는 nx/ny 대신 이 좌표를 표시합니다.
   */
  const STATIONS = [
    { name: '마곡', sector: 'west', nx: 57, ny: 127, lat: 37.58143, lon: 126.81477 },
    { name: '망원', sector: 'west', nx: 58, ny: 126, lat: 37.53483, lon: 126.87233 },
    { name: '여의도', sector: 'west', nx: 59, ny: 126, lat: 37.53431, lon: 126.93048 },
    { name: '압구정', sector: 'east', nx: 61, ny: 126, lat: 37.53317, lon: 127.04678 },
    { name: '옥수', sector: 'east', nx: 61, ny: 126, lat: 37.53317, lon: 127.04678 },
    { name: '서울숲', sector: 'east', nx: 61, ny: 126, lat: 37.53317, lon: 127.04678 },
    { name: '뚝섬', sector: 'east', nx: 61, ny: 126, lat: 37.53317, lon: 127.04678 },
    { name: '잠실', sector: 'east', nx: 62, ny: 126, lat: 37.53255, lon: 127.10493 }
  ];

  function getSharedSettings() {
    const shared = window.HANGANG_WEATHER_CONFIG || {};
    const proxyBase = String(shared.PROXY_BASE || '').trim().replace(/\/$/, '');

    if (
      shared.ENABLED !== false &&
      /^https:\/\//i.test(proxyBase)
    ) {
      return { proxyBase, source: 'shared' };
    }

    return null;
  }

  function getSettings() {
    const shared = getSharedSettings();
    if (shared) return shared;

    return {};
  }

  function saveSettings() {}

  function clearSettings() {}

  function isConfigured() {
    return Boolean(getSettings().proxyBase);
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

  function floorHour(date = new Date()) {
    return new Date(Math.floor(date.getTime() / 3600000) * 3600000);
  }

  function ceilHour(date = new Date()) {
    return new Date(Math.ceil(date.getTime() / 3600000) * 3600000);
  }

  function hourlyCandidates(offsetHours = 0, count = 3) {
    const anchor = floorHour(new Date(Date.now() - offsetHours * 3600000));
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(anchor.getTime() - i * 3600000);
      return { date: formatDate(d), time: formatTime(d, 0), dateObj: d };
    });
  }

  function halfHourlyCandidates(count = 6) {
    const anchor = new Date(Math.floor(Date.now() / 1800000) * 1800000);
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(anchor.getTime() - i * 1800000);
      const minute = kstParts(d).minute < '30' ? 0 : 30;
      return { date: formatDate(d), time: formatTime(d, minute), dateObj: d };
    });
  }

  function shortForecastCandidates(count = 4) {
    const cycles = [2,5,8,11,14,17,20,23];
    const now = new Date();
    const p = kstParts(now);
    const dateText = `${p.year}-${p.month}-${p.day}`;
    const candidates = [];

    for (let dayOffset = 0; candidates.length < count && dayOffset < 2; dayOffset++) {
      const day = new Date(`${dateText}T00:00:00+09:00`);
      day.setTime(day.getTime() - dayOffset * 86400000);
      const limitHour = dayOffset === 0 ? Number(p.hour) : 24;

      [...cycles].reverse().forEach(hour => {
        if (candidates.length >= count || hour > limitHour) return;
        const d = new Date(day.getTime() + hour * 3600000);
        candidates.push({ date: formatDate(d), time: `${String(hour).padStart(2,'0')}00` });
      });
    }

    return candidates;
  }

  function endpoint(path, params, proxyBase) {
    const url = new URL(`${proxyBase}/kma`);
    url.searchParams.set('apiPath', path);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    return url.toString();
  }

  async function fetchJson(path, params, proxyBase) {
    const url = endpoint(
      path,
      { pageNo: 1, numOfRows: 1000, dataType: 'JSON', ...params },
      proxyBase
    );

    let res;

    try {
      res = await fetch(url, { method: 'GET', cache: 'no-store' });
    } catch (error) {
      throw new Error(`기상청 중계 호출 실패: ${error.message}`);
    }
    if (!res.ok) {
      let detail = '';
      try {
        const raw = await res.text();
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            detail =
              parsed.error ||
              parsed.upstreamBody ||
              parsed.upstreamStatusText ||
              raw;
          } catch (_) {
            detail = raw;
          }
        }
      } catch (_) {}

      detail = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 220);
      throw new Error(
        `기상청 중계 HTTP ${res.status}${detail ? ` · ${detail}` : ''}`
      );
    }
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


  async function fetchTextUrl(path, params, proxyBase) {
    const url = new URL(`${proxyBase}/${path}`);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    url.searchParams.set('_ts', Date.now());
    const res = await fetch(url, { method:'GET', cache:'no-store' });
    if (!res.ok) {
      const detail = (await res.text()).replace(/\s+/g,' ').slice(0,180);
      throw new Error(`${path} HTTP ${res.status}${detail ? ` · ${detail}` : ''}`);
    }
    return res.text();
  }

  function compactIso(value) {
    const s = String(value || '').replace(/\D/g,'');
    if (s.length < 12) return null;
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:00+09:00`;
  }

  function validObs(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > -8 ? n : null;
  }

  function parseAsosCurrent(text) {
    const lines = String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const line = lines.find(x => !x.startsWith('#') && /^\d{12,14}\s+\d+\s+/.test(x));
    if (!line) throw new Error('ASOS 관측 행을 찾지 못했습니다. 지상관측 시간자료 API 활용신청을 확인하십시오.');
    const c = line.split(/\s+/);
    const observedAt = compactIso(c[0]);
    const station = Number(c[1]);
    const windDirectionDeg = validObs(c[2]) === null ? null : Number(c[2]) * 10;
    const windSpeed = validObs(c[3]);
    const gustDirectionDeg = validObs(c[4]) === null ? null : Number(c[4]) * 10;
    const rawGust = validObs(c[5]);
    const gust = rawGust !== null && rawGust > 0 ? rawGust : null;
    const gustTime = gust === null ? '' : String(c[6] || '');
    return {
      observedAt, station, windDirectionDeg, windSpeed,
      gustDirectionDeg, gust, gustTime,
      sourceLabel: ASOS_REFERENCE.name
    };
  }

  async function fetchAsosCurrent(proxyBase) {
    const text = await fetchTextUrl('asos', { stn: ASOS_REFERENCE.stn }, proxyBase);
    return parseAsosCurrent(text);
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

  function parseRainDetail(value) {
    const raw = String(value ?? '').trim();
    const compact = raw.replace(/\s+/g, '');

    // PCP 항목 자체가 없거나 원기관이 결측기호를 보낸 경우
    if (
      !compact ||
      /^[-–—]+$/.test(compact) ||
      /자료없음|미제공|결측|확인필요/.test(compact)
    ) {
      return {
        raw,
        lower: null,
        upper: null,
        safety: 0,
        display: '-',
        hasAmount: false,
        available: false,
        qualifier: 'missing'
      };
    }

    if (/강수없음|없음/.test(compact)) {
      return {
        raw,
        lower: 0,
        upper: 0,
        safety: 0,
        display: '0.0',
        hasAmount: false,
        available: true,
        qualifier: 'none'
      };
    }

    if (/미만/.test(compact)) {
      const n = Number(compact.match(/[\d.]+/)?.[0]);

      if (Number.isFinite(n)) {
        return {
          raw,
          lower: 0,
          upper: n,
          safety: n,
          display: `<${formatRainNumber(n)}`,
          hasAmount: true,
          available: true,
          qualifier: 'less-than'
        };
      }
    }

    if (/이상/.test(compact)) {
      const n = Number(compact.match(/[\d.]+/)?.[0]);

      if (Number.isFinite(n)) {
        return {
          raw,
          lower: n,
          upper: null,
          safety: n,
          display: `≥${formatRainNumber(n)}`,
          hasAmount: true,
          available: true,
          qualifier: 'at-least'
        };
      }
    }

    if (compact.includes('~')) {
      const nums = compact.match(/[\d.]+/g)?.map(Number) || [];

      if (nums.length >= 2 && nums.every(Number.isFinite)) {
        const lower = Math.min(nums[0], nums[1]);
        const upper = Math.max(nums[0], nums[1]);

        return {
          raw,
          lower,
          upper,
          safety: upper,
          display: `${formatRainNumber(lower)}~${formatRainNumber(upper)}`,
          hasAmount: upper > 0,
          available: true,
          qualifier: 'range'
        };
      }
    }

    // 0.0mm, 1mm처럼 단위가 붙은 정확값 처리
    const exactMatch = compact.match(
      /^(-?\d+(?:\.\d+)?)(?:mm)?$/i
    );

    if (exactMatch) {
      const exact = Number(exactMatch[1]);

      if (Number.isFinite(exact)) {
        return {
          raw,
          lower: exact,
          upper: exact,
          safety: exact,
          display: formatRainNumber(exact),
          hasAmount: exact > 0,
          available: true,
          qualifier: 'exact'
        };
      }
    }

    return {
      raw,
      lower: null,
      upper: null,
      safety: 0,
      display: '-',
      hasAmount: false,
      available: false,
      qualifier: 'unknown'
    };
  }

  function formatRainNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return n >= 10 || Number.isInteger(n)
      ? String(n)
      : n.toFixed(1);
  }

  function parseRain(value) {
    return parseRainDetail(value).safety;
  }

  function direction16(deg) {
    const names = ['북','북북동','북동','동북동','동','동남동','남동','남남동','남','남남서','남서','서남서','서','서북서','북서','북북서'];
    const n = Number(deg);
    if (!Number.isFinite(n)) return '-';
    return names[Math.round((((n % 360) + 360) % 360) / 22.5) % 16];
  }

  function forecastForHour(list, hourOffset) {
    if (!Array.isArray(list) || !list.length) return null;
    const firstHour = ceilHour(new Date());
    const target = firstHour.getTime() + (hourOffset - 1) * 3600000;
    const future = list.filter(x => new Date(x.time).getTime() >= firstHour.getTime() - 60000);
    if (!future.length) return null;
    return future.reduce((best, x) => {
      const diff = Math.abs(new Date(x.time).getTime() - target);
      return !best || diff < best.diff ? { item:x, diff } : best;
    }, null)?.item || null;
  }

  async function fetchNowcastForGrid(grid, proxyBase, offsetHours = 0) {
    let lastError = null;
    for (const base of hourlyCandidates(offsetHours, 3)) {
      try {
        const body = await fetchJson('VilageFcstInfoService_2.0/getUltraSrtNcst', {
          base_date:base.date, base_time:base.time, nx:grid.nx, ny:grid.ny
        }, proxyBase);
        const list = items(body);
        if (!list.length) continue;
        const map = categoryMap(list,'obsrValue');
        const sample = list[0];
        return {
          observedAt:isoFromKma(sample.baseDate||base.date,sample.baseTime||base.time),
          speed:num(map.WSD), directionDeg:num(map.VEC), direction:direction16(map.VEC),
          rain1h:parseRain(map.RN1), humidity:num(map.REH), temperature:num(map.T1H),
          precipitationType:map.PTY, raw:map
        };
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error(`초단기실황 자료 없음 (${grid.nx},${grid.ny})`);
  }

  async function fetchUltraForecastForGrid(grid, proxyBase) {
    let lastError = null;
    for (const base of halfHourlyCandidates(6)) {
      try {
        const body = await fetchJson('VilageFcstInfoService_2.0/getUltraSrtFcst', {
          base_date:base.date, base_time:base.time, nx:grid.nx, ny:grid.ny
        }, proxyBase);
        const list = forecastGroups(items(body));
        if (!list.length) continue;
        return { issuedAt:isoFromKma(base.date,base.time), timeline:list };
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error(`초단기예보 자료 없음 (${grid.nx},${grid.ny})`);
  }

  async function fetchShortForecastForGrid(grid, proxyBase) {
    let lastError = null;
    for (const base of shortForecastCandidates(4)) {
      try {
        const body = await fetchJson('VilageFcstInfoService_2.0/getVilageFcst', {
          base_date:base.date, base_time:base.time, nx:grid.nx, ny:grid.ny
        }, proxyBase);
        const list = forecastGroups(items(body));
        if (!list.length) continue;
        return { issuedAt:isoFromKma(base.date,base.time), timeline:list };
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error(`단기예보 자료 없음 (${grid.nx},${grid.ny})`);
  }

  const WEATHER_ALERT_TYPES = [
    '강풍', '풍랑', '호우', '대설', '건조',
    '폭풍해일', '한파', '태풍', '황사', '폭염'
  ];

  function hasSpecificWeatherAlert(text) {
    const source = String(text || '');
    const typePattern = WEATHER_ALERT_TYPES.join('|');
    return new RegExp(
      `(?:${typePattern}).{0,14}(?:주의보|경보|예비특보)|` +
      `(?:주의보|경보|예비특보).{0,14}(?:${typePattern})`
    ).test(source);
  }

  function stripSituationNotice(text) {
    return String(text || '')
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !(
        /아래.*사이트.*참고/.test(line) ||
        /기상청\s*날씨누리/.test(line) ||
        /방재기상정보시스템/.test(line) ||
        /특보현황/.test(line) ||
        /www\.weather\.go\.kr/i.test(line) ||
        /afso\.kma\.go\.kr/i.test(line)
      ))
      .join('\n')
      .trim();
  }

  function extractAlertNames(text, fallback) {
    const names = [];
    const source = String(text || '');
    const typePattern = WEATHER_ALERT_TYPES.join('|');
    const pattern = new RegExp(
      `(${typePattern})\\s*(주의보|경보|예비특보)`,
      'g'
    );

    for (const match of source.matchAll(pattern)) {
      const name = `${match[1]}${match[2]}`;
      if (!names.includes(name)) names.push(name);
    }

    return names.length ? names.join(' · ') : fallback;
  }

  function inferAlertArea(text) {
    const source = String(text || '');
    const areas = [
      ['서울특별시', /서울특별시|서울(?!·수도권)/],
      ['인천광역시', /인천광역시|인천/],
      ['경기도', /경기도|경기/]
    ]
      .filter(([, pattern]) => pattern.test(source))
      .map(([name]) => name);

    return areas.length ? areas.join(' · ') : '서울·수도권';
  }

  async function fetchSituation(proxyBase) {
    const body = await fetchJson('VilageFcstMsgService/getWthrSituation', {
      pageNo: 1, numOfRows: 10, dataType: 'JSON', stnId: 109
    }, proxyBase);

    const list = items(body);

    if (!list.length) {
      return {
        issuedAt: null,
        alerts: [],
        status: {
          area: '서울·수도권',
          warning: '자료 없음',
          preliminary: '자료 없음',
          message: '기상개황 응답에 특보 자료가 없습니다.'
        }
      };
    }

    const latest = [...list]
      .sort((a,b) => String(b.tmFc || '').localeCompare(String(a.tmFc || '')))[0];

    const issuedAt = parseSituationTime(latest.tmFc);
    const warningRaw = cleanText(latest.wn);
    const preliminaryRaw = cleanText(latest.wr);
    const warningText = stripSituationNotice(warningRaw);
    const preliminaryText = stripSituationNotice(preliminaryRaw);

    const warningActive = hasSpecificWeatherAlert(warningText);
    const preliminaryActive = hasSpecificWeatherAlert(preliminaryText);
    const alerts = [];

    if (warningActive) {
      alerts.push({
        source: 'official',
        level: /경보/.test(warningText) ? 'warning' : 'advisory',
        area: inferAlertArea(warningText),
        title: extractAlertNames(warningText, '기상특보 발표'),
        message: warningText,
        issuedAt,
        effectiveAt: null
      });
    }

    if (preliminaryActive) {
      alerts.push({
        source: 'preliminary',
        level: 'watch',
        area: inferAlertArea(preliminaryText),
        title: extractAlertNames(preliminaryText, '예비특보 발표'),
        message: preliminaryText,
        issuedAt,
        effectiveAt: null
      });
    }

    return {
      issuedAt,
      alerts,
      status: {
        area: '서울특별시·수도권',
        warning: warningActive
          ? extractAlertNames(warningText, '특보 발표 중')
          : '현재 발효 특보 없음',
        preliminary: preliminaryActive
          ? extractAlertNames(preliminaryText, '예비특보 발표 중')
          : '현재 예비특보 없음',
        message:
          !warningActive && !preliminaryActive
            ? '기상청 안내문은 특보로 처리하지 않았습니다.'
            : '특보 종류와 발표 문구를 기상청 원문 기준으로 표시합니다.'
      }
    };
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
    const { proxyBase } = getSettings();
    if (!proxyBase) throw new Error('기상청 중계 Worker 주소가 설정되지 않았습니다.');

    const unique = [...new Map(STATIONS.map(s => [`${s.nx},${s.ny}`, {nx:s.nx,ny:s.ny}])).values()];
    const [currentEntries, ultraEntries, shortEntries] = await Promise.all([
      Promise.all(unique.map(async g => [`${g.nx},${g.ny}`, await fetchNowcastForGrid(g,proxyBase,0)])),
      Promise.all(unique.map(async g => [`${g.nx},${g.ny}`, await fetchUltraForecastForGrid(g,proxyBase)])),
      Promise.all(unique.map(async g => [`${g.nx},${g.ny}`, await fetchShortForecastForGrid(g,proxyBase)]))
    ]);

    const currentMap=Object.fromEntries(currentEntries);
    const ultraMap=Object.fromEntries(ultraEntries);
    const shortMap=Object.fromEntries(shortEntries);

    const windStations=STATIONS.map(st=>{
      const key=`${st.nx},${st.ny}`;
      const current=currentMap[key];
      const ultra=ultraMap[key];
      const forecasts=[1,2].map(hour=>{
        const f=forecastForHour(ultra.timeline,hour);
        return f?{
          hour, time:f.time, direction:direction16(f.VEC), directionDeg:num(f.VEC), speed:num(f.WSD)
        }:null;
      }).filter(Boolean);

      return {
        name:st.name, sector:st.sector, lat:st.lat, lon:st.lon,
        observedAt:current.observedAt,
        direction:current.direction, directionDeg:current.directionDeg, speed:current.speed,
        sourceLabel:'기상청 초단기실황',
        forecasts
      };
    });

    const rainEntries=['west','east'].map(sector=>[
      sector,
      buildRouteRainfall(STATIONS.filter(st=>st.sector===sector),currentMap,shortMap)
    ]);

    const situation=await fetchSituation(proxyBase);
    const observedTimes=windStations.map(x=>new Date(x.observedAt).getTime()).filter(Number.isFinite);
    const observedAt=observedTimes.length?new Date(Math.max(...observedTimes)).toISOString():null;
    const forecastIssuedAt=rainEntries.map(([,r])=>r.forecastIssuedAt).filter(Boolean).sort().at(-1)||null;

    return {
      weather:{windStations,rainfall:Object.fromEntries(rainEntries)},
      alerts:situation.alerts, alertStatus:situation.status,
      observedAt, forecastIssuedAt, fetchedAt:new Date().toISOString(),
      sourceLabel:'기상청 API허브',
      warnings:[]
    };
  }

  function uniqueGridGroups(stations) {
    const grouped = new Map();

    stations.forEach(st => {
      const key = `${st.nx},${st.ny}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          nx: st.nx,
          ny: st.ny,
          lat: st.lat,
          lon: st.lon,
          names: []
        });
      }

      grouped.get(key).names.push(st.name);
    });

    return [...grouped.values()];
  }

  function maxCandidate(candidates, valueKey) {
    const valid = candidates
      .filter(x => Number.isFinite(Number(x[valueKey])))
      .sort((a,b) => Number(b[valueKey]) - Number(a[valueKey]));

    if (!valid.length) {
      return {
        value: 0,
        source: '자료 없음',
        available: false
      };
    }

    const maxValue = Number(valid[0][valueKey]);
    const sources = valid
      .filter(x => Number(x[valueKey]) === maxValue)
      .flatMap(x => x.names)
      .filter((name, index, all) => all.indexOf(name) === index);

    return {
      value: maxValue,
      source: sources.join('·'),
      available: true
    };
  }

  function buildRouteRainfall(stations,currentMap,shortMap) {
    const groups=uniqueGridGroups(stations);

    const currentCandidates=groups.map(group=>{
      const value=currentMap[group.key];
      return {
        names:group.names,
        amount:Number(value?.rain1h),
        observedAt:value?.observedAt||null
      };
    });

    const currentMax=maxCandidate(currentCandidates,'amount');
    const candidatesByTime=new Map();
    const firstForecast=ceilHour(new Date()).getTime();

    groups.forEach(group=>{
      const short=shortMap[group.key];

      (short?.timeline||[])
        .filter(row=>new Date(row.time).getTime()>=firstForecast-60000)
        .forEach(row=>{
          const detail=parseRainDetail(row.PCP);
          const candidate={
            time:row.time,
            names:group.names,
            source:group.names.join('·'),
            probability:num(row.POP,0),
            pty:num(row.PTY,0),
            sky:num(row.SKY,1),
            rawAmount:String(row.PCP??'').trim(),
            amountLower:detail.lower,
            amountUpper:detail.upper,
            amountSafety:detail.safety,
            amountDisplay:detail.display,
            amountQualifier:detail.qualifier,
            hasAmount:detail.hasAmount,
            amountAvailable:detail.available
          };

          if(!candidatesByTime.has(row.time)){
            candidatesByTime.set(row.time,[]);
          }

          candidatesByTime.get(row.time).push(candidate);
        });
    });

    const future=[...candidatesByTime.entries()]
      .sort((a,b)=>new Date(a[0])-new Date(b[0]))
      .slice(0,24)
      .map(([time,candidates])=>{
        const available=candidates.filter(
          candidate=>candidate.amountAvailable
        );

        const pool=available.length?available:candidates;

        const selected=[...pool].sort((a,b)=>
          b.amountSafety-a.amountSafety ||
          b.probability-a.probability
        )[0];

        return {
          ...selected,
          time,
          label:labelTime(time),
          amount:selected.amountSafety,
          type:'forecast'
        };
      });

    const horizon=hours=>{
      const rows=future.slice(0,hours);
      const expectedCount=hours;
      const availableRows=rows.filter(row=>row.amountAvailable);
      const unavailableCount=
        Math.max(0,expectedCount-rows.length) +
        rows.filter(row=>!row.amountAvailable).length;

      const lower=availableRows.reduce(
        (sum,row)=>sum+num(row.amountLower),
        0
      );

      const hasOpenUpper=availableRows.some(
        row=>row.amountUpper===null &&
          row.amountQualifier==='at-least'
      );

      const upper=hasOpenUpper
        ? null
        : availableRows.reduce(
            (sum,row)=>sum+num(row.amountUpper),
            0
          );

      const safety=availableRows.reduce(
        (sum,row)=>sum+num(row.amountSafety),
        0
      );

      const probability=rows.length
        ? Math.max(...rows.map(row=>num(row.probability)))
        : 0;

      const amountDisplay=rainAccumulationDisplay(lower,upper);
      const complete=unavailableCount===0&&rows.length===expectedCount;

      return {
        lower,
        upper,
        safety,
        probability,
        count:rows.length,
        expectedCount,
        availableCount:availableRows.length,
        unavailableCount,
        complete,
        amountDisplay,
        display:complete?amountDisplay:'부분자료'
      };
    };

    const h3=horizon(3);
    const h6=horizon(6);
    const h12=horizon(12);
    const h24=horizon(24);

    const observedAt=currentCandidates
      .map(x=>new Date(x.observedAt).getTime())
      .filter(Number.isFinite);

    const forecastIssuedAt=groups
      .map(group=>shortMap[group.key]?.issuedAt)
      .filter(Boolean)
      .sort()
      .at(-1)||null;

    const basisLabel=groups.map(group=>
      `${group.names.join('·')} ${Number(group.lat).toFixed(5)}°N, ${Number(group.lon).toFixed(5)}°E`
    ).join(' / ');

    const dataAvailable=currentMax.available&&future.length>0;
    const allDry=dataAvailable&&
      currentMax.value===0&&
      future.every(row=>row.amountUpper===0);

    return {
      observedAt:observedAt.length
        ? new Date(Math.max(...observedAt)).toISOString()
        : null,
      forecastIssuedAt,
      forecastStartAt:future[0]?.time||null,

      currentRate:currentMax.value,
      currentSource:currentMax.source,

      next3h:h3.safety,
      next6h:h6.safety,
      next12h:h12.safety,
      next24h:h24.safety,

      next3hDisplay:h3.display,
      next6hDisplay:h6.display,
      next12hDisplay:h12.display,
      next24hDisplay:h24.display,

      next3hAmountDisplay:h3.amountDisplay,
      next6hAmountDisplay:h6.amountDisplay,
      next12hAmountDisplay:h12.amountDisplay,
      next24hAmountDisplay:h24.amountDisplay,

      next3hReliable:h3.complete,
      next6hReliable:h6.complete,
      next12hReliable:h12.complete,
      next24hReliable:h24.complete,

      next3hAvailableCount:h3.availableCount,
      next6hAvailableCount:h6.availableCount,
      next12hAvailableCount:h12.availableCount,
      next24hAvailableCount:h24.availableCount,

      next3hMissingCount:h3.unavailableCount,
      next6hMissingCount:h6.unavailableCount,
      next12hMissingCount:h12.unavailableCount,
      next24hMissingCount:h24.unavailableCount,

      next3hProbability:h3.probability,
      next6hProbability:h6.probability,
      next12hProbability:h12.probability,
      next24hProbability:h24.probability,

      forecastHourCount:future.length,
      next3hCount:h3.count,
      next6hCount:h6.count,
      next12hCount:h12.count,
      next24hCount:h24.count,

      basisLabel,
      aggregationLabel:
        '시간별로 한 개 대표격자를 선택해 동일 격자의 강수량·확률·강수형태를 사용',
      allDry,
      dataAvailable,
      dryMessage:!dataAvailable
        ? '실황 또는 단기예보 응답이 부족합니다.'
        : allDry
          ? '현재 실황과 향후 예보가 모든 대표격자에서 강수없음입니다.'
          : '',
      timeline:future.slice(0,8),
      timelineHours:Math.min(8,future.length),
      rainContributors:future
        .filter(row=>
          row.amountAvailable &&
          (
            row.amountUpper===null ||
            Number(row.amountUpper)>0
          )
        )
        .map(row=>({
          time:row.time,
          label:row.label,
          amountDisplay:row.amountDisplay,
          amountLower:row.amountLower,
          amountUpper:row.amountUpper,
          amountSafety:row.amountSafety,
          source:row.source,
          rawAmount:row.rawAmount
        })),
      missingAmountHours:future
        .filter(row=>!row.amountAvailable)
        .map(row=>({
          time:row.time,
          label:row.label,
          source:row.source,
          rawAmount:row.rawAmount
        })),
      observationIntervalMinutes:60,
      forecastIntervalMinutes:60,
      sourceLabel:
        '기상청 초단기실황 RN1 · 단기예보 PCP(1시간 강수량)·POP'
    };
  }

  function rainAccumulationDisplay(lower,upper){
    const low=Number(lower);
    const high=upper===null?null:Number(upper);

    if(!Number.isFinite(low))return '-';

    if(high===null){
      return `≥${formatRainNumber(low)}`;
    }

    if(!Number.isFinite(high)){
      return formatRainNumber(low);
    }

    if(Math.abs(high-low)<1e-9){
      return formatRainNumber(low);
    }

    if(low===0&&high<=1){
      return `<${formatRainNumber(high)}`;
    }

    return `${formatRainNumber(low)}~${formatRainNumber(high)}`;
  }

  function labelTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('ko-KR', { timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit', hour12:false });
  }

  async function testConnection() {
    const {proxyBase}=getSettings();
    if(!proxyBase) throw new Error('기상청 중계 Worker 주소가 없습니다.');
    const test=await fetchNowcastForGrid({nx:60,ny:127},proxyBase,0);
    const situation=await fetchSituation(proxyBase);
    return {
      ok:true,
      observedAt:test.observedAt,
      speed:test.speed,
      direction:test.direction,
      rain1h:test.rain1h,
      alertCount:situation.alerts.length
    };
  }

  window.KMA = {
    getSettings, saveSettings, clearSettings, isConfigured,
    testConnection, loadWeather, stations: STATIONS.slice()
  };
})();
