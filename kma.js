(() => {
  'use strict';

  const cfg = window.HANGANG_CONFIG;
  const KMA_CFG = cfg.KMA || {};
  const STORAGE_KEY = KMA_CFG.STORAGE_KEY || 'hangangbus_kma_settings_v1';

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

  async function fetchNowcastForGrid(grid, proxyBase, offsetHours = 0) {
    const base = getUltraNowBase(offsetHours);
    const body = await fetchJson('VilageFcstInfoService_2.0/getUltraSrtNcst', {
      base_date: base.date, base_time: base.time, nx: grid.nx, ny: grid.ny
    }, proxyBase);
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

  async function fetchUltraForecastForGrid(grid, proxyBase) {
    const base = getUltraForecastBase();
    const body = await fetchJson('VilageFcstInfoService_2.0/getUltraSrtFcst', {
      base_date: base.date, base_time: base.time, nx: grid.nx, ny: grid.ny
    }, proxyBase);
    const list = forecastGroups(items(body));
    if (!list.length) throw new Error(`초단기예보 자료 없음 (${grid.nx},${grid.ny})`);
    return { issuedAt: isoFromKma(base.date, base.time), timeline: list };
  }

  async function fetchShortForecastForGrid(grid, proxyBase) {
    const base = getShortForecastBase();
    const body = await fetchJson('VilageFcstInfoService_2.0/getVilageFcst', {
      base_date: base.date, base_time: base.time, nx: grid.nx, ny: grid.ny
    }, proxyBase);
    const list = forecastGroups(items(body));
    if (!list.length) throw new Error(`단기예보 자료 없음 (${grid.nx},${grid.ny})`);
    return { issuedAt: isoFromKma(base.date, base.time), timeline: list };
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

    const unique = [...new Map(STATIONS.map(s => [`${s.nx},${s.ny}`, { nx:s.nx, ny:s.ny }])).values()];
    const currentEntries = await Promise.all(unique.map(async g => [`${g.nx},${g.ny}`, await fetchNowcastForGrid(g, proxyBase, 0)]));
    const previousEntries = await Promise.all(unique.map(async g => [`${g.nx},${g.ny}`, await fetchNowcastForGrid(g, proxyBase, 1)]));
    const ultraEntries = await Promise.all(unique.map(async g => [`${g.nx},${g.ny}`, await fetchUltraForecastForGrid(g, proxyBase)]));
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

    // 노선별 강수량은 단일 지점이 아니라 노선 내 모든 대표 격자의
    // 시간대별 최대값을 사용합니다. 운항 참고용으로 보수적으로 계산합니다.
    const shortEntries = await Promise.all(
      unique.map(async g => [
        `${g.nx},${g.ny}`,
        await fetchShortForecastForGrid(g, proxyBase)
      ])
    );
    const shortMap = Object.fromEntries(shortEntries);

    const rainEntries = ['west', 'east'].map(sector => {
      const stations = STATIONS.filter(st => st.sector === sector);
      return [
        sector,
        buildRouteRainfall(stations, currentMap, previousMap, shortMap)
      ];
    });

    const situation = await fetchSituation(proxyBase);
    const observedTimes = windStations.map(x => new Date(x.observedAt).getTime()).filter(Number.isFinite);
    const observedAt = observedTimes.length ? new Date(Math.max(...observedTimes)).toISOString() : new Date().toISOString();
    const forecastIssuedAt = rainEntries.map(([,r]) => r.forecastIssuedAt).filter(Boolean)[0] || new Date().toISOString();

    return {
      weather: {
        windStations,
        rainfall: Object.fromEntries(rainEntries)
      },
      alerts: situation.alerts,
      alertStatus: situation.status,
      observedAt,
      forecastIssuedAt,
      fetchedAt: new Date().toISOString(),
      sourceLabel: '기상청 API허브'
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

  function buildRouteRainfall(stations, currentMap, previousMap, shortMap) {
    const groups = uniqueGridGroups(stations);

    const currentCandidates = groups.map(group => {
      const value = currentMap[group.key];

      return {
        names: group.names,
        amount: Number(value?.rain1h ?? 0),
        observedAt: value?.observedAt || null
      };
    });

    const previousCandidates = groups.map(group => {
      const value = previousMap[group.key];

      return {
        names: group.names,
        amount: Number(value?.rain1h ?? 0),
        observedAt: value?.observedAt || null
      };
    });

    const currentMax = maxCandidate(currentCandidates, 'amount');
    const previousMax = maxCandidate(previousCandidates, 'amount');
    const forecastByTime = new Map();
    const cutoff = Date.now() - 30 * 60000;

    groups.forEach(group => {
      const short = shortMap[group.key];

      (short?.timeline || [])
        .filter(row => new Date(row.time).getTime() >= cutoff)
        .forEach(row => {
          const amount = parseRain(row.PCP);
          const probability = num(row.POP, 0);
          const existing = forecastByTime.get(row.time) || {
            time: row.time,
            amount: -1,
            probability: -1,
            amountSource: '',
            probabilitySource: ''
          };

          if (amount > existing.amount) {
            existing.amount = amount;
            existing.amountSource = group.names.join('·');
          }

          if (probability > existing.probability) {
            existing.probability = probability;
            existing.probabilitySource = group.names.join('·');
          }

          forecastByTime.set(row.time, existing);
        });
    });

    const future = [...forecastByTime.values()]
      .sort((a,b) => new Date(a.time) - new Date(b.time))
      .slice(0, 24)
      .map(row => ({
        time: row.time,
        label: labelTime(row.time),
        amount: Math.max(0, row.amount),
        probability: Math.max(0, row.probability),
        source: row.amountSource || row.probabilitySource || '노선 대표격자',
        type: 'forecast'
      }));

    const horizon = hours => {
      const rows = future.slice(0, hours);

      return {
        amount: rows.reduce((sum, row) => sum + num(row.amount), 0),
        probability: rows.length
          ? Math.max(...rows.map(row => num(row.probability)))
          : 0
      };
    };

    const h3 = horizon(3);
    const h6 = horizon(6);
    const h12 = horizon(12);
    const h24 = horizon(24);

    const observedAt = currentCandidates
      .map(x => new Date(x.observedAt).getTime())
      .filter(Number.isFinite);

    const previousAt = previousCandidates
      .map(x => new Date(x.observedAt).getTime())
      .filter(Number.isFinite);

    const forecastIssuedAt = groups
      .map(group => shortMap[group.key]?.issuedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null;

    const basisLabel = groups
      .map(group => `${group.names.join('·')}(${group.nx},${group.ny})`)
      .join(' / ');

    const timeline = [
      {
        time: previousAt.length
          ? new Date(Math.max(...previousAt)).toISOString()
          : null,
        label: previousAt.length
          ? labelTime(new Date(Math.max(...previousAt)).toISOString())
          : '-',
        amount: previousMax.value,
        probability: null,
        source: previousMax.source,
        type: 'observed'
      },
      {
        time: observedAt.length
          ? new Date(Math.max(...observedAt)).toISOString()
          : null,
        label: observedAt.length
          ? labelTime(new Date(Math.max(...observedAt)).toISOString())
          : '-',
        amount: currentMax.value,
        probability: null,
        source: currentMax.source,
        type: 'current'
      },
      ...future.slice(0, 9)
    ];

    const dataAvailable = currentMax.available && future.length > 0;
    const allDry =
      dataAvailable &&
      currentMax.value === 0 &&
      future.every(row => row.amount === 0);

    return {
      observedAt: observedAt.length
        ? new Date(Math.max(...observedAt)).toISOString()
        : null,
      forecastIssuedAt,
      currentRate: currentMax.value,
      currentSource: currentMax.source,
      next3h: h3.amount,
      next6h: h6.amount,
      next12h: h12.amount,
      next24h: h24.amount,
      next3hProbability: h3.probability,
      next6hProbability: h6.probability,
      next12hProbability: h12.probability,
      next24hProbability: h24.probability,
      basisLabel,
      aggregationLabel: '노선 내 대표격자별 시간당 최대 강수량 합계',
      dataAvailable,
      allDry,
      dryMessage: allDry
        ? '현재 및 예보 PCP가 전 대표격자에서 강수없음으로 응답했습니다.'
        : dataAvailable
          ? ''
          : '강수 실황 또는 예보 자료가 누락되어 0mm로 판단하지 않습니다.',
      timeline,
      observationIntervalMinutes: 60,
      forecastIntervalMinutes: 60,
      sourceLabel: '기상청 초단기실황 RN1·단기예보 PCP·POP'
    };
  }

  function labelTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('ko-KR', { timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit', hour12:false });
  }

  async function testConnection() {
    const { proxyBase } = getSettings();
    if (!proxyBase) throw new Error('기상청 중계 Worker 주소가 없습니다.');
    const test = await fetchNowcastForGrid({ nx: 60, ny: 127 }, proxyBase, 0);
    const situation = await fetchSituation(proxyBase);
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
