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

  const RAIN_REPRESENTATIVES = {
    west: '마곡',
    east: '잠실'
  };

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


  async function fetchWorkerJson(path, params, proxyBase) {
    const url = new URL(`${proxyBase}/${path}`);

    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    url.searchParams.set('_ts', Date.now());

    let response;

    try {
      response = await fetch(url.toString(), {
        method:'GET',
        cache:'no-store'
      });
    } catch (error) {
      throw new Error(`공식 기상특보 호출 실패: ${error.message}`);
    }

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `${path} HTTP ${response.status} · ${
          text.replace(/\s+/g,' ').slice(0,180)
        }`
      );
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (_) {
      throw new Error(
        `공식 기상특보 JSON 파싱 실패 · ${text.slice(0,140)}`
      );
    }

    if (parsed?.ok === false) {
      throw new Error(
        parsed.error ||
        parsed.upstreamBody ||
        '공식 기상특보 Worker 오류'
      );
    }

    const responseBody = parsed?.response;

    if (responseBody) {
      const code = responseBody?.header?.resultCode;

      if (code && code !== '00') {
        throw new Error(
          `공식 기상특보 API 오류 ${code}: ${
            responseBody?.header?.resultMsg || '알 수 없음'
          }`
        );
      }

      return responseBody?.body || {};
    }

    return parsed;
  }

  function addKstDateDays(dateKey, offset) {
    const year = Number(dateKey.slice(0,4));
    const month = Number(dateKey.slice(4,6));
    const day = Number(dateKey.slice(6,8));
    const date = new Date(
      Date.UTC(year, month - 1, day + offset, 3, 0, 0)
    );
    return formatDate(date);
  }

  function recordText(record) {
    const excluded = new Set([
      'pageNo', 'numOfRows', 'totalCount', 'dataType',
      'stnId', 'tmSeq', 'tmFc', 'title'
    ]);
    const values = [];

    const walk = value => {
      if (value === null || value === undefined) return;

      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }

      if (typeof value === 'object') {
        Object.entries(value).forEach(([key, child]) => {
          if (!excluded.has(key)) walk(child);
        });
        return;
      }

      const text = cleanText(value);

      if (
        text &&
        !values.includes(text) &&
        !/^(00|NORMAL_SERVICE|JSON|XML)$/.test(text)
      ) {
        values.push(text);
      }
    };

    walk(record);
    return values.join('\n');
  }

  function recordTime(record) {
    return (
      parseSituationTime(record?.tmFc) ||
      parseSituationTime(record?.tm) ||
      parseSituationTime(record?.announceTime) ||
      null
    );
  }

  function recordMatchesList(detail, listItem) {
    const detailTm = String(detail?.tmFc || '').replace(/\D/g,'');
    const listTm = String(listItem?.tmFc || '').replace(/\D/g,'');
    const detailSeq = String(detail?.tmSeq ?? '');
    const listSeq = String(listItem?.tmSeq ?? '');

    if (detailTm && listTm && detailTm !== listTm) return false;
    if (detailSeq && listSeq && detailSeq !== listSeq) return false;

    return Boolean(detailTm || detailSeq);
  }

  function mergeListAndDetail(listItem, details) {
    const matched = details.filter(
      detail => recordMatchesList(detail, listItem)
    );

    const selected = matched.length
      ? matched
      : details.filter(detail => {
          const detailDate = String(detail?.tmFc || '').slice(0,8);
          const listDate = String(listItem?.tmFc || '').slice(0,8);
          return detailDate && detailDate === listDate;
        });

    return {
      ...listItem,
      officialDetailRecords:selected,
      officialDetailText:selected
        .map(recordText)
        .filter(Boolean)
        .join('\n')
    };
  }

  function officialUnclassifiedAlert({
    source,
    record,
    detailText
  }) {
    const preliminary = source === 'preliminary';
    const issuedAt = recordTime(record);

    return {
      source,
      scope:'official-unclassified',
      operationImpact:false,
      level:preliminary ? 'watch' : 'advisory',
      levelLabel:preliminary ? '예비특보' : '특보',
      weatherTypes:extractWeatherTypes(
        `${record?.title || ''} ${detailText || ''}`
      ),
      area:'수도권 발표관서 109',
      title:
        record?.title ||
        (preliminary
          ? '수도권 공식 예비특보'
          : '수도권 공식 기상특보'),
      message:
        detailText ||
        '기상청 공식 목록에서 발표가 확인되었습니다. 상세지역은 원문 확인이 필요합니다.',
      issuedAt,
      effectiveAt:null,
      effectiveEndAt:null,
      periodText:'상세 발효시간은 공식 통보문 확인',
      periods:[],
      official:true
    };
  }

  function alertsFromOfficialRecords({
    source,
    list,
    details
  }) {
    const now = new Date();
    const sorted = [...list].sort(
      (a,b) =>
        String(b?.tmFc || '').localeCompare(
          String(a?.tmFc || '')
        )
    );

    const recent = sorted.filter(record => {
      const issuedAt = recordTime(record);
      if (!issuedAt) return false;

      const age = now - new Date(issuedAt);
      const limit = source === 'preliminary'
        ? 36 * 60 * 60000
        : 18 * 60 * 60000;

      return age >= -60 * 60000 && age <= limit;
    }).slice(0,4);

    const alerts = [];

    recent.forEach(listItem => {
      const merged = mergeListAndDetail(listItem, details);
      const detailText = cleanText(
        merged.officialDetailText || ''
      );
      const combinedText = [
        listItem?.title,
        detailText
      ].filter(Boolean).join('\n');

      // 호우·강풍·태풍이 아닌 공식 발표는 표시하지 않습니다.
      if (!extractWeatherTypes(combinedText).length) {
        return;
      }

      const scoped = buildAlert({
        source,
        text:combinedText,
        issuedAt:recordTime(listItem)
      });

      if (scoped.length) {
        scoped.forEach(alert => {
          alert.official = true;
          alert.officialTitle = listItem?.title || '';
          alert.stationId = String(listItem?.stnId || '');
          alert.tmSeq = listItem?.tmSeq ?? null;
        });
        alerts.push(...scoped);
      } else if (extractWeatherTypes(combinedText).length) {
        alerts.push(officialUnclassifiedAlert({
          source,
          record:listItem,
          detailText
        }));
      }
    });

    return alerts;
  }

  function statusAlertsFromItems(statusItems) {
    const alerts = [];

    statusItems.forEach(item => {
      const text = [
        item?.title,
        recordText(item)
      ].filter(Boolean).join('\n');

      if (!extractWeatherTypes(text).length) return;
      if (/해제|특보\s*없음|발효\s*없음/.test(text)) return;

      const scoped = buildAlert({
        source:'official',
        text,
        issuedAt:recordTime(item) || new Date().toISOString()
      });

      scoped.forEach(alert => {
        alert.official = true;
        alert.currentStatus = true;
      });

      alerts.push(...scoped);
    });

    return alerts;
  }

  async function fetchOfficialWarningSituation(proxyBase) {
    const today = formatDate(new Date());
    const fromSixDays = addKstDateDays(today, -6);
    const fromTwoDays = addKstDateDays(today, -2);
    const common = {
      pageNo:1,
      numOfRows:100,
      dataType:'JSON',
      stnId:109
    };

    const results = await Promise.allSettled([
      fetchWorkerJson(
        'kma-warning/preliminary-list',
        {
          ...common,
          fromTmFc:fromSixDays,
          toTmFc:today
        },
        proxyBase
      ),
      fetchWorkerJson(
        'kma-warning/preliminary',
        {
          ...common,
          fromTmFc:fromSixDays,
          toTmFc:today
        },
        proxyBase
      ),
      fetchWorkerJson(
        'kma-warning/list',
        {
          ...common,
          fromTmFc:fromTwoDays,
          toTmFc:today
        },
        proxyBase
      ),
      fetchWorkerJson(
        'kma-warning/message',
        {
          ...common,
          fromTmFc:fromTwoDays,
          toTmFc:today
        },
        proxyBase
      ),
      fetchWorkerJson(
        'kma-warning/status',
        { dataType:'JSON' },
        proxyBase
      )
    ]);

    const fulfilled = index =>
      results[index].status === 'fulfilled'
        ? results[index].value
        : null;

    const preliminaryListBody = fulfilled(0);
    const preliminaryDetailBody = fulfilled(1);
    const warningListBody = fulfilled(2);
    const warningMessageBody = fulfilled(3);
    const statusBody = fulfilled(4);

    if (!preliminaryListBody && !warningListBody && !statusBody) {
      const errors = results
        .filter(result => result.status === 'rejected')
        .map(result => result.reason?.message)
        .filter(Boolean);

      throw new Error(
        errors.join(' / ') ||
        '공식 기상특보 응답 없음'
      );
    }

    const preliminaryList = items(preliminaryListBody);
    const preliminaryDetails = items(preliminaryDetailBody);
    const warningList = items(warningListBody);
    const warningDetails = items(warningMessageBody);
    const statusItems = items(statusBody);

    const officialAlerts = dedupeAlerts([
      ...statusAlertsFromItems(statusItems),
      ...alertsFromOfficialRecords({
        source:'official',
        list:warningList,
        details:warningDetails
      }),
      ...alertsFromOfficialRecords({
        source:'preliminary',
        list:preliminaryList,
        details:preliminaryDetails
      })
    ]).sort((a,b) => {
      const priority = {
        warning:0,
        advisory:1,
        watch:2,
        reference:3
      };

      return (
        (priority[a.level] ?? 9) -
        (priority[b.level] ?? 9) ||
        new Date(b.issuedAt || 0) -
        new Date(a.issuedAt || 0)
      );
    });

    const directOfficial = officialAlerts.filter(
      alert =>
        alert.scope === 'seoul-direct' &&
        alert.source === 'official'
    );
    const directPreliminary = officialAlerts.filter(
      alert =>
        alert.scope === 'seoul-direct' &&
        alert.source === 'preliminary'
    );
    const upstream = officialAlerts.filter(
      alert => alert.scope === 'paldang-upstream'
    );
    const unclassified = officialAlerts.filter(
      alert => alert.scope === 'official-unclassified'
    );

    const latestIssuedAt = officialAlerts
      .map(alert => alert.issuedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null;

    return {
      issuedAt:latestIssuedAt,
      alerts:officialAlerts,
      status:{
        sourceMode:'official-warning-api',
        area:'서울특별시·팔당 상류권',
        warning:directOfficial.length
          ? directOfficial.map(alert => alert.title).join(' · ')
          : '서울 발효 특보 없음',
        preliminary:directPreliminary.length
          ? directPreliminary.map(alert => alert.title).join(' · ')
          : '서울 예비특보 없음',
        upstream:upstream.length
          ? upstream.map(alert => alert.title).join(' · ')
          : '팔당 상류 영향특보 없음',
        unclassified:unclassified.length
          ? unclassified.map(alert => alert.title).join(' · ')
          : '',
        message:
          '운항 관련 특보만 표시: 호우·강풍·태풍'
      },
      diagnostics:{
        preliminaryListCount:preliminaryList.length,
        preliminaryDetailCount:preliminaryDetails.length,
        warningListCount:warningList.length,
        warningDetailCount:warningDetails.length,
        statusCount:statusItems.length,
        failedPaths:results
          .map((result,index) => ({
            index,
            failed:result.status === 'rejected',
            reason:
              result.status === 'rejected'
                ? result.reason?.message
                : ''
          }))
          .filter(row => row.failed)
      }
    };
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

  /*
   * 한강버스 운항 관련 핵심 특보만 표시합니다.
   * 폭염·건조·한파·황사·대설·풍랑·폭풍해일은 화면에서 제외합니다.
   */
  const WEATHER_ALERT_TYPES = [
    '호우',
    '강풍',
    '태풍'
  ];

  /*
   * 서울 직접 운항판정 지역
   * - 서울특별시가 발표 대상에 명시된 특보만 직접 운항판정에 사용
   */
  const SEOUL_DIRECT_PATTERNS = [
    /서울특별시/,
    /서울시/,
    /(?:^|[\s,(])서울(?:[\s,):]|$)/
  ];

  /*
   * 팔당댐 상류 영향 참고지역
   * - 경기 동부 중 팔당 유역 및 인접 상류권
   * - 호우·태풍 특보만 방류 증가 가능성 참고자료로 사용
   */
  const PALDANG_UPSTREAM_AREAS = [
    ['가평군', /가평군|가평/],
    ['양평군', /양평군|양평/],
    ['남양주시', /남양주시|남양주/],
    ['광주시', /광주시(?!.*광역시)|경기광주/],
    ['하남시', /하남시|하남/],
    ['여주시', /여주시|여주/],
    ['이천시', /이천시|이천/]
  ];

  const PALDANG_UPSTREAM_WEATHER_TYPES = ['호우', '태풍'];


  function hasSpecificWeatherAlert(text) {
    const source = String(text || '');
    const typePattern = WEATHER_ALERT_TYPES.join('|');
    return new RegExp(
      `(?:${typePattern}).{0,24}(?:주의보|경보|예비특보)|` +
      `(?:주의보|경보|예비특보).{0,24}(?:${typePattern})`
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
      `(${typePattern})\\s*(주의보|경보|예비특보)|` +
      `(주의보|경보|예비특보)\\s*(${typePattern})`,
      'g'
    );

    for (const match of source.matchAll(pattern)) {
      const weatherType = match[1] || match[4];
      const alertType = match[2] || match[3];
      const name = alertType === '예비특보'
        ? `${weatherType} 예비특보`
        : `${weatherType}${alertType}`;

      if (!names.includes(name)) names.push(name);
    }

    return names.length ? names.join(' · ') : fallback;
  }

  function extractWeatherTypes(text) {
    const source = String(text || '');
    return WEATHER_ALERT_TYPES.filter(type => source.includes(type));
  }

  function containsSeoulDirectArea(text) {
    const source = String(text || '');
    return SEOUL_DIRECT_PATTERNS.some(pattern => pattern.test(source));
  }

  function matchedPaldangUpstreamAreas(text) {
    const source = String(text || '');

    return PALDANG_UPSTREAM_AREAS
      .filter(([, pattern]) => pattern.test(source))
      .map(([name]) => name);
  }

  function containsPaldangUpstreamWeather(text) {
    const source = String(text || '');
    return PALDANG_UPSTREAM_WEATHER_TYPES.some(type => source.includes(type));
  }

  function scopedAreaLabel(scope, text) {
    if (scope === 'seoul-direct') return '서울특별시';

    if (scope === 'paldang-upstream') {
      const areas = matchedPaldangUpstreamAreas(text);
      return areas.length
        ? `경기 동부 · ${areas.join('·')}`
        : '경기 동부 팔당 상류권';
    }

    return '기타지역';
  }

  function scopedTitle(scope, baseTitle) {
    if (scope === 'paldang-upstream') {
      return `팔당 상류 영향 참고 · ${baseTitle}`;
    }
    return baseTitle;
  }

  function buildScopedAlerts({
    source,
    text,
    issuedAt
  }) {
    const alerts = [];
    const period = parseAlertEffectivePeriod(text, issuedAt);
    const weatherTypes = extractWeatherTypes(text);
    const preliminaryFallback =
      weatherTypes.length
        ? weatherTypes.map(type => `${type} 예비특보`).join(' · ')
        : '기상 예비특보';

    const baseTitle = extractAlertNames(
      text,
      source === 'preliminary'
        ? preliminaryFallback
        : '기상특보 발표'
    );

    if (containsSeoulDirectArea(text)) {
      alerts.push({
        source,
        scope:'seoul-direct',
        operationImpact:true,
        level:alertLevel(text, source),
        levelLabel:alertLevelLabel(text, source),
        weatherTypes:extractWeatherTypes(text),
        area:scopedAreaLabel('seoul-direct', text),
        title:scopedTitle('seoul-direct', baseTitle),
        message:text,
        issuedAt,
        effectiveAt:period.effectiveAt,
        effectiveEndAt:period.effectiveEndAt,
        periodText:period.periodText,
        periods:period.periods
      });
    }

    const upstreamAreas = matchedPaldangUpstreamAreas(text);

    if (
      upstreamAreas.length &&
      containsPaldangUpstreamWeather(text)
    ) {
      alerts.push({
        source,
        scope:'paldang-upstream',
        operationImpact:false,
        level:'reference',
        levelLabel:'상류 참고',
        weatherTypes:extractWeatherTypes(text).filter(
          type => PALDANG_UPSTREAM_WEATHER_TYPES.includes(type)
        ),
        area:scopedAreaLabel('paldang-upstream', text),
        title:scopedTitle('paldang-upstream', baseTitle),
        message:text,
        issuedAt,
        effectiveAt:period.effectiveAt,
        effectiveEndAt:period.effectiveEndAt,
        periodText:period.periodText,
        periods:period.periods
      });
    }

    return alerts;
  }

  function alertLevel(text, source) {
    if (source === 'preliminary') return 'watch';
    if (/경보/.test(text)) return 'warning';
    return 'advisory';
  }

  function alertLevelLabel(text, source) {
    if (source === 'preliminary') return '예비특보';
    if (/경보/.test(text)) return '경보';
    if (/주의보/.test(text)) return '주의보';
    return '특보';
  }

  function inferAlertYear(month, issuedAt) {
    const issued = issuedAt ? new Date(issuedAt) : new Date();
    let year = Number(
      new Intl.DateTimeFormat('en', {
        timeZone:'Asia/Seoul',
        year:'numeric'
      }).format(issued)
    );

    const issuedMonth = Number(
      new Intl.DateTimeFormat('en', {
        timeZone:'Asia/Seoul',
        month:'numeric'
      }).format(issued)
    );

    if (issuedMonth === 12 && month === 1) year += 1;
    if (issuedMonth === 1 && month === 12) year -= 1;
    return year;
  }

  function kstIso(year, month, day, hour, minute = 0) {
    const y = String(year).padStart(4,'0');
    const m = String(month).padStart(2,'0');
    const d = String(day).padStart(2,'0');
    const h = String(hour).padStart(2,'0');
    const min = String(minute).padStart(2,'0');
    return `${y}-${m}-${d}T${h}:${min}:00+09:00`;
  }

  function parseAlertEffectivePeriod(text, issuedAt) {
    const source = String(text || '').replace(/\s+/g,' ').trim();
    const periods = [];

    /*
     * 예비특보 예:
     * 07월 18일 새벽(00시~06시)
     * 07월 18일 아침(06~09시)
     */
    const rangePattern =
      /(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일\s*([가-힣]+)?\s*\(\s*(\d{1,2})(?:시)?(?:\s*(\d{1,2})분)?\s*[~～\-]\s*(\d{1,2})(?:시)?(?:\s*(\d{1,2})분)?\s*\)/g;

    for (const match of source.matchAll(rangePattern)) {
      const month = Number(match[2]);
      const day = Number(match[3]);
      const startHour = Number(match[5]);
      const startMinute = Number(match[6] || 0);
      const endHourRaw = Number(match[7]);
      const endMinute = Number(match[8] || 0);
      const year = Number(match[1]) || inferAlertYear(month, issuedAt);
      const endHour = endHourRaw === 24 ? 23 : endHourRaw;

      periods.push({
        label:
          `${String(month).padStart(2,'0')}.${String(day).padStart(2,'0')} ` +
          `${match[4] || ''}(${String(startHour).padStart(2,'0')}:${String(startMinute).padStart(2,'0')}~` +
          `${String(endHourRaw).padStart(2,'0')}:${String(endMinute).padStart(2,'0')})`,
        start: kstIso(year, month, day, startHour, startMinute),
        end: kstIso(year, month, day, endHour, endMinute)
      });
    }

    /*
     * 실제 특보 예:
     * 발효시각 2026년 7월 17일 18시 00분
     */
    if (!periods.length) {
      const effectivePattern =
        /(?:발효(?:예정)?(?:시각)?|예상시각)\s*[:：]?\s*(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시(?:\s*(\d{1,2})분)?/;

      const match = source.match(effectivePattern);

      if (match) {
        const month = Number(match[2]);
        const day = Number(match[3]);
        const hour = Number(match[4]);
        const minute = Number(match[5] || 0);
        const year = Number(match[1]) || inferAlertYear(month, issuedAt);
        const start = kstIso(year, month, day, hour, minute);

        periods.push({
          label:
            `${String(month).padStart(2,'0')}.${String(day).padStart(2,'0')} ` +
            `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,
          start,
          end:null
        });
      }
    }

    if (!periods.length) {
      return {
        effectiveAt:null,
        effectiveEndAt:null,
        periodText:'기상청 발표 원문 참고',
        periods:[]
      };
    }

    const sorted = [...periods].sort(
      (a,b)=>new Date(a.start)-new Date(b.start)
    );

    const validEnds = sorted
      .map(period=>period.end)
      .filter(Boolean)
      .sort((a,b)=>new Date(a)-new Date(b));

    return {
      effectiveAt:sorted[0].start,
      effectiveEndAt:validEnds.at(-1) || null,
      periodText:sorted.map(period=>period.label).join(' · '),
      periods:sorted
    };
  }

  function isRecentPreliminary(alert, now = new Date()) {
    const issued = alert.issuedAt ? new Date(alert.issuedAt) : null;
    const end = alert.effectiveEndAt
      ? new Date(alert.effectiveEndAt)
      : null;
    const start = alert.effectiveAt
      ? new Date(alert.effectiveAt)
      : null;

    if (end && now <= new Date(end.getTime() + 60 * 60000)) {
      return true;
    }

    if (start && start > now && start-now <= 72*60*60000) {
      return true;
    }

    return issued && now-issued <= 36*60*60000;
  }

  function dedupeAlerts(alerts) {
    const result = [];
    const keys = new Set();

    alerts.forEach(alert=>{
      const key = [
        alert.source,
        alert.scope || '',
        alert.title,
        alert.periodText || '',
        alert.area || ''
      ].join('|');

      if (keys.has(key)) return;
      keys.add(key);
      result.push(alert);
    });

    return result;
  }

  function buildAlert({
    source,
    text,
    issuedAt
  }) {
    return buildScopedAlerts({ source, text, issuedAt });
  }


  function sectionAroundKeyword(text, keyword) {
    const source = cleanText(text);
    const index = source.indexOf(keyword);

    if (index < 0) return '';

    const previousHeading = Math.max(
      source.lastIndexOf('\n*', index),
      source.lastIndexOf('\n□', index),
      source.lastIndexOf('\n■', index)
    );

    const start = previousHeading >= 0
      ? previousHeading + 1
      : Math.max(0, index - 120);

    const nextCandidates = [
      source.indexOf('\n*', index + keyword.length),
      source.indexOf('\n□', index + keyword.length),
      source.indexOf('\n■', index + keyword.length)
    ].filter(value => value >= 0);

    const end = nextCandidates.length
      ? Math.min(...nextCandidates)
      : Math.min(source.length, index + 3200);

    return source.slice(start, end).trim();
  }

  function preliminaryTextFromItem(item) {
    /*
     * wr는 기상청 응답정의상 예비특보 전용 필드입니다.
     * wr 본문에 '예비특보'라는 단어가 반복되지 않아도
     * 내용이 있으면 예비특보로 처리해야 합니다.
     */
    const direct = stripSituationNotice(cleanText(item?.wr));

    if (
      direct &&
      !/예비특보\s*없음|특보\s*없음|해당\s*없음|현재\s*없음/.test(direct)
    ) {
      return direct;
    }

    const extracted = sectionAroundKeyword(
      item?.wfSv1,
      '예비특보'
    );

    if (
      extracted &&
      !/예비특보\s*없음|특보\s*없음|해당\s*없음|현재\s*없음/.test(extracted)
    ) {
      return stripSituationNotice(extracted);
    }

    return '';
  }

  function officialWarningTextFromItem(item) {
    const direct = stripSituationNotice(cleanText(item?.wn));

    if (
      direct &&
      !/특보\s*없음|발효\s*없음|현재.*없음|해당\s*없음/.test(direct)
    ) {
      return direct;
    }

    const extracted = sectionAroundKeyword(
      item?.wfSv1,
      '특보현황'
    );

    if (
      extracted &&
      !/특보현황.{0,30}없음|현재.*특보.*없음/.test(extracted)
    ) {
      return stripSituationNotice(extracted);
    }

    return '';
  }

  async function fetchSituation(proxyBase) {
    const body = await fetchJson('VilageFcstMsgService/getWthrSituation', {
      pageNo: 1,
      numOfRows: 10,
      dataType: 'JSON',
      stnId: 109
    }, proxyBase);

    const list = items(body)
      .sort(
        (a,b)=>
          String(b.tmFc || '').localeCompare(String(a.tmFc || ''))
      );

    if (!list.length) {
      return {
        issuedAt:null,
        alerts:[],
        status:{
          area:'서울·수도권',
          warning:'자료 없음',
          preliminary:'자료 없음',
          message:'기상개황 응답에 특보 자료가 없습니다.'
        }
      };
    }

    const newest = list[0];
    const latestIssuedAt = parseSituationTime(newest.tmFc);
    const alerts = [];

    /*
     * 실제 발효 특보는 최신 발표문의 wn을 현재상태로 사용합니다.
     * 이전 발표의 해제된 특보가 다시 살아나는 것을 방지합니다.
     */
    const latestWarningText = officialWarningTextFromItem(
      newest
    );

    if (
      hasSpecificWeatherAlert(latestWarningText) &&
      !/해제|특보\s*없음|발효\s*없음/.test(latestWarningText)
    ) {
      alerts.push(...buildAlert({
        source:'official',
        text:latestWarningText,
        issuedAt:latestIssuedAt
      }));
    }

    /*
     * 예비특보는 발표 시점의 문서에만 들어가고 다음 일반예보에는
     * 반복되지 않을 수 있으므로 최근 10개 발표를 모두 검색합니다.
     */
    list.forEach(item=>{
      const issuedAt = parseSituationTime(item.tmFc);
      const text = preliminaryTextFromItem(item);

      /*
       * wr 자체가 예비특보 필드이므로 본문에 '예비특보',
       * '주의보', '경보'라는 단어가 없어도 기상현상명이
       * 한 개 이상 있으면 유효 예비특보로 처리합니다.
       */
      if (
        !text ||
        !extractWeatherTypes(text).length ||
        /해제|취소|예비특보\s*없음|특보\s*없음/.test(text)
      ) {
        return;
      }

      const scopedAlerts = buildAlert({
        source:'preliminary',
        text,
        issuedAt
      });

      scopedAlerts.forEach(alert => {
        if (isRecentPreliminary(alert)) {
          alerts.push(alert);
        }
      });
    });

    const uniqueAlerts = dedupeAlerts(alerts).sort((a,b)=>{
      const priority = {
        warning:0,
        advisory:1,
        watch:2,
        reference:3
      };

      return (
        (priority[a.level] ?? 9) -
        (priority[b.level] ?? 9) ||
        new Date(b.issuedAt || 0) -
        new Date(a.issuedAt || 0)
      );
    });

    const directOfficialAlerts = uniqueAlerts.filter(
      alert=>
        alert.scope==='seoul-direct' &&
        alert.source==='official'
    );
    const directPreliminaryAlerts = uniqueAlerts.filter(
      alert=>
        alert.scope==='seoul-direct' &&
        alert.source==='preliminary'
    );
    const upstreamAlerts = uniqueAlerts.filter(
      alert=>alert.scope==='paldang-upstream'
    );

    return {
      issuedAt:latestIssuedAt,
      alerts:uniqueAlerts,
      status:{
        sourceMode:'forecast-message-fallback',
        area:'서울특별시',
        warning:directOfficialAlerts.length
          ? directOfficialAlerts.map(alert=>alert.title).join(' · ')
          : '기상특보 전용 API 미연결',
        preliminary:directPreliminaryAlerts.length
          ? directPreliminaryAlerts.map(alert=>alert.title).join(' · ')
          : '통보문 보조조회에서 서울 예비특보 미확인',
        upstream:upstreamAlerts.length
          ? upstreamAlerts.map(alert=>alert.title).join(' · ')
          : '통보문 보조조회에서 팔당 상류 특보 미확인',
        message:uniqueAlerts.length
          ? '현재 통보문 보조조회에서 확인된 특보입니다.'
          : '전용 기상특보 API 연결 전에는 공식 특보 없음으로 확정하지 않습니다.'
      }
    };
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/\\r/g, '')
      .replace(/\\n/g, '\n')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
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

    const rainEntries=['west','east'].map(sector=>{
      const representativeName=RAIN_REPRESENTATIVES[sector];
      const representative=STATIONS.find(
        station=>station.name===representativeName
      );

      const rainfall=buildRouteRainfall(
        representative ? [representative] : [],
        currentMap,
        shortMap
      );

      rainfall.representativeName=
        representative?.name || representativeName;
      rainfall.representativeLat=
        representative?.lat ?? null;
      rainfall.representativeLon=
        representative?.lon ?? null;

      return [sector,rainfall];
    });

    let situation;

    try {
      situation=await fetchOfficialWarningSituation(proxyBase);
    } catch (officialError) {
      situation=await fetchSituation(proxyBase);
      situation.status={
        ...(situation.status||{}),
        sourceMode:'forecast-message-fallback',
        officialError:officialError.message,
        message:
          `공식 특보 API 호출 실패 · 통보문 보조조회 사용 · ${officialError.message}`
      };
    }

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
    let situation;

    try {
      situation=await fetchOfficialWarningSituation(proxyBase);
    } catch (_) {
      situation=await fetchSituation(proxyBase);
    }

    return {
      ok:true,
      observedAt:test.observedAt,
      speed:test.speed,
      direction:test.direction,
      rain1h:test.rain1h,
      alertCount:situation.alerts.length,
      alertSource:situation.status?.sourceMode || 'unknown'
    };
  }

  window.KMA = {
    getSettings, saveSettings, clearSettings, isConfigured,
    testConnection, loadWeather, stations: STATIONS.slice()
  };
})();
