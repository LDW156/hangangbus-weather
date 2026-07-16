(() => {
  'use strict';

  const cfg = window.HANGANG_CONFIG;
  const STORAGE_KEY = cfg.HRFCO?.STORAGE_KEY || 'hangangbus_hrfco_urls_v1';

  function isValidHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function getSharedSettings() {
    const shared = window.HANGANG_SHARED_CONFIG?.HRFCO || {};
    const settings = {
      paldangUrl: String(shared.PALDANG_URL || '').trim(),
      jamsuUrl: String(shared.JAMSU_URL || '').trim(),
      hangangUrl: String(shared.HANGANG_URL || '').trim()
    };

    return (
      shared.ENABLED !== false &&
      isValidHttpUrl(settings.paldangUrl) &&
      isValidHttpUrl(settings.jamsuUrl) &&
      isValidHttpUrl(settings.hangangUrl)
    ) ? settings : null;
  }

  function getSettings() {
    const shared = getSharedSettings();
    if (shared) return { ...shared, source: 'shared' };

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function clearSettings() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function isConfigured() {
    const s = getSettings();
    return Boolean(
      isValidHttpUrl(s.paldangUrl) &&
      isValidHttpUrl(s.jamsuUrl) &&
      isValidHttpUrl(s.hangangUrl)
    );
  }

  function isSharedConfigured() {
    return Boolean(getSharedSettings());
  }

  function kstParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
    return parts;
  }

  function formatApiTime(date) {
    const p = kstParts(date);
    return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`;
  }

  function roundDown10(date = new Date()) {
    const ms = date.getTime();
    return new Date(Math.floor(ms / 600000) * 600000);
  }

  function updateTimeWindow(rawUrl, historyMinutes = 130) {
    const url = String(rawUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('HRFCO URL 형식이 올바르지 않습니다.');

    const end = roundDown10(new Date(Date.now() - 10 * 60000));
    const start = new Date(end.getTime() - historyMinutes * 60000);
    const startText = formatApiTime(start);
    const endText = formatApiTime(end);
    const matches = [...url.matchAll(/\d{12}/g)];

    if (matches.length >= 2) {
      const lastTwo = matches.slice(-2);
      let out = url;
      out = out.slice(0, lastTwo[1].index) + endText + out.slice(lastTwo[1].index + 12);
      out = out.slice(0, lastTwo[0].index) + startText + out.slice(lastTwo[0].index + 12);
      return out;
    }

    return url;
  }

  async function fetchXml(rawUrl) {
    const url = updateTimeWindow(rawUrl, cfg.HRFCO?.HISTORY_MINUTES || 130);
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error(`HRFCO HTTP ${res.status}`);
    const text = await res.text();
    if (!text || !text.includes('<')) throw new Error('HRFCO XML 응답이 비어 있습니다.');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) throw new Error('HRFCO XML 파싱 실패');
    return doc;
  }

  function nodeText(node, names) {
    for (const name of names) {
      const direct = node.getElementsByTagName(name)[0];
      if (direct && direct.textContent.trim() !== '') return direct.textContent.trim();
      const all = [...node.getElementsByTagName('*')];
      const found = all.find(x => x.localName?.toLowerCase() === name.toLowerCase());
      if (found && found.textContent.trim() !== '') return found.textContent.trim();
    }
    return '';
  }

  function num(v) {
    const n = Number(String(v ?? '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }

  function parseApiTimestamp(v) {
    const s = String(v || '').replace(/\D/g, '');
    if (s.length < 12) return null;
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:00+09:00`;
  }

  function timeLabel(timestamp) {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour:'2-digit', minute:'2-digit', hour12:false });
  }

  function contentRecords(doc) {
    const contents = [...doc.getElementsByTagName('content')];
    const candidates = [];
    for (const content of contents) {
      for (const child of [...content.children]) {
        if (child.nodeType === 1) candidates.push(child);
      }
    }
    if (candidates.length) return candidates;
    return [...doc.getElementsByTagName('*')].filter(el =>
      ['dam','waterlevel','wl'].includes((el.localName || '').toLowerCase())
    );
  }

  function padHistory(records, type) {
    if (!records.length) return records;
    const sorted = [...records].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    while (sorted.length < 7) {
      const first = sorted[0];
      const ts = new Date(new Date(first.timestamp).getTime() - 10 * 60000).toISOString();
      sorted.unshift({ ...first, timestamp: ts, time: timeLabel(ts), padded: true });
    }
    return sorted;
  }

  function parseWaterLevel(doc, sourceLabel) {
    const rows = contentRecords(doc).map(node => {
      const timestamp = parseApiTimestamp(nodeText(node, ['ymdhm','obstm','tm','time']));
      const value = num(nodeText(node, ['wl','waterlevel','wlev','wlvalue','value']));
      return timestamp && value !== null ? { timestamp, time: timeLabel(timestamp), value } : null;
    }).filter(Boolean);

    const history = padHistory(rows, 'water');
    if (!history.length) {
      const tags = [...doc.getElementsByTagName('*')].map(x => x.localName).filter(Boolean);
      throw new Error(`${sourceLabel} 수위 필드를 찾지 못했습니다. 확인된 태그: ${[...new Set(tags)].slice(0,20).join(', ')}`);
    }
    const latest = history[history.length - 1];
    return {
      waterLevelM: latest.value,
      observedAt: latest.timestamp,
      intervalMinutes: 10,
      history,
      sourceLabel,
      live: true
    };
  }

  function parseDam(doc) {
    const rows = contentRecords(doc).map(node => {
      const timestamp = parseApiTimestamp(nodeText(node, ['ymdhm','obstm','tm','time']));
      const inflow = num(nodeText(node, ['inf','inflow','infl']));
      const outflow = num(nodeText(node, ['tototf','outflow','totoutf','totot']));
      return timestamp && inflow !== null && outflow !== null
        ? { timestamp, time: timeLabel(timestamp), inflow, outflow }
        : null;
    }).filter(Boolean);

    const history = padHistory(rows, 'dam');
    if (!history.length) {
      const tags = [...doc.getElementsByTagName('*')].map(x => x.localName).filter(Boolean);
      throw new Error(`팔당댐 유입·방류 필드를 찾지 못했습니다. 확인된 태그: ${[...new Set(tags)].slice(0,20).join(', ')}`);
    }
    const latest = history[history.length - 1];
    return {
      inflowCms: latest.inflow,
      outflowCms: latest.outflow,
      observedAt: latest.timestamp,
      intervalMinutes: 10,
      history,
      sourceLabel: '팔당댐 수문자료',
      live: true
    };
  }

  async function loadHydrology() {
    const s = getSettings();
    if (!s.paldangUrl || !s.jamsuUrl || !s.hangangUrl) {
      throw new Error('수문 URL 3개가 아직 등록되지 않았습니다.');
    }

    const [paldangDoc, jamsuDoc, hangangDoc] = await Promise.all([
      fetchXml(s.paldangUrl), fetchXml(s.jamsuUrl), fetchXml(s.hangangUrl)
    ]);

    const paldang = parseDam(paldangDoc);
    const jamsuBridge = parseWaterLevel(jamsuDoc, '잠수교 수위');
    const hangangBridge = parseWaterLevel(hangangDoc, '한강대교 수위');

    return {
      paldang, jamsuBridge, hangangBridge,
      fetchedAt: new Date().toISOString()
    };
  }

  async function testUrl(type, rawUrl) {
    const doc = await fetchXml(rawUrl);
    if (type === 'paldang') return parseDam(doc);
    return parseWaterLevel(doc, type === 'jamsu' ? '잠수교 수위' : '한강대교 수위');
  }

  function applySharedUiState() {
    if (!isSharedConfigured()) return;

    const shared = window.HANGANG_SHARED_CONFIG?.HRFCO || {};
    const button = document.getElementById('hydrologySettingsBtn');

    if (button && shared.SHOW_SETTINGS_BUTTON === false) {
      button.hidden = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applySharedUiState);
  } else {
    applySharedUiState();
  }

  window.HRFCO = {
    getSettings, saveSettings, clearSettings, isConfigured, isSharedConfigured,
    loadHydrology, testUrl, updateTimeWindow
  };
})();
