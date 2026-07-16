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
      return { ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'), source: 'local' };
    } catch (_) {
      return {};
    }
  }

  function saveSettings(settings) { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
  function clearSettings() { localStorage.removeItem(STORAGE_KEY); }
  function isConfigured() {
    const s = getSettings();
    return isValidHttpUrl(s.paldangUrl) && isValidHttpUrl(s.jamsuUrl) && isValidHttpUrl(s.hangangUrl);
  }
  function isSharedConfigured() { return Boolean(getSharedSettings()); }

  function kstParts(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hourCycle:'h23'
    }).formatToParts(date).reduce((a,x)=>(a[x.type]=x.value,a),{});
  }
  function formatApiTime(date) {
    const p=kstParts(date); return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`;
  }
  function roundDown10(date = new Date()) {
    return new Date(Math.floor(date.getTime()/600000)*600000);
  }
  function updateTimeWindow(rawUrl, historyMinutes = 130) {
    const url=String(rawUrl||'').trim();
    if(!isValidHttpUrl(url)) throw new Error('HRFCO URL 형식이 올바르지 않습니다.');
    // 기존에는 현재시각에서 10분을 추가로 빼 11:39에도 11:20까지만 조회했습니다.
    // 현재 10분 단위 시각까지 요청하고, 원본 API가 보유한 최신 레코드를 사용합니다.
    const end=roundDown10(new Date());
    const start=new Date(end.getTime()-historyMinutes*60000);
    const matches=[...url.matchAll(/\d{12}/g)];
    if(matches.length>=2){
      const lastTwo=matches.slice(-2); let out=url;
      out=out.slice(0,lastTwo[1].index)+formatApiTime(end)+out.slice(lastTwo[1].index+12);
      out=out.slice(0,lastTwo[0].index)+formatApiTime(start)+out.slice(lastTwo[0].index+12);
      return out;
    }
    return url;
  }
  async function fetchXml(rawUrl) {
    const url=updateTimeWindow(rawUrl,cfg.HRFCO?.HISTORY_MINUTES||130);
    const res=await fetch(url,{method:'GET',cache:'no-store'});
    if(!res.ok) throw new Error(`HRFCO HTTP ${res.status}`);
    const text=await res.text();
    if(!text||!text.includes('<')) throw new Error('HRFCO XML 응답이 비어 있습니다.');
    const doc=new DOMParser().parseFromString(text,'application/xml');
    if(doc.querySelector('parsererror')) throw new Error('HRFCO XML 파싱 실패');
    return doc;
  }
  function nodeText(node,names){
    for(const name of names){
      const direct=node.getElementsByTagName(name)[0];
      if(direct&&direct.textContent.trim()!=='') return direct.textContent.trim();
      const found=[...node.getElementsByTagName('*')].find(x=>x.localName?.toLowerCase()===name.toLowerCase());
      if(found&&found.textContent.trim()!=='') return found.textContent.trim();
    }
    return '';
  }
  function num(v){ const n=Number(String(v??'').replace(/,/g,'').trim()); return Number.isFinite(n)?n:null; }
  function parseApiTimestamp(v){
    const s=String(v||'').replace(/\D/g,''); if(s.length<12)return null;
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:00+09:00`;
  }
  function timeLabel(timestamp){
    const d=new Date(timestamp); if(Number.isNaN(d.getTime()))return '-';
    return d.toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
  }
  function contentRecords(doc){
    const contents=[...doc.getElementsByTagName('content')], candidates=[];
    for(const content of contents) for(const child of [...content.children]) if(child.nodeType===1)candidates.push(child);
    if(candidates.length)return candidates;
    return [...doc.getElementsByTagName('*')].filter(el=>['dam','waterlevel','wl'].includes((el.localName||'').toLowerCase()));
  }
  function cleanHistory(rows){
    const byTime=new Map();
    rows.forEach(row=>{ if(row?.timestamp) byTime.set(row.timestamp,row); });
    return [...byTime.values()].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  }

  /*
   * HRFCO는 새로운 10분 구간이 생성되는 순간 값이 아직 확정되지 않아
   * 0으로 채워진 최신 행을 잠시 반환할 수 있습니다. 직전 행이 정상값인데
   * 최신 행만 0이면 미확정 자료로 보고 제외합니다.
   */
  function removeTrailingProvisionalRows(history, isProvisional){
    const confirmed=[...history];
    const ignored=[];

    while(confirmed.length>=2){
      const latest=confirmed.at(-1);
      const previous=confirmed.at(-2);
      if(!isProvisional(latest,previous)) break;
      ignored.unshift(confirmed.pop());
    }

    return {confirmed,ignored};
  }
  function parseWaterLevel(doc,sourceLabel){
    const rows=contentRecords(doc).map(node=>{
      const timestamp=parseApiTimestamp(nodeText(node,['ymdhm','obstm','tm','time']));
      const value=num(nodeText(node,['wl','waterlevel','wlev','wlvalue','value']));
      return timestamp&&value!==null?{timestamp,time:timeLabel(timestamp),value}:null;
    }).filter(Boolean);

    const cleaned=cleanHistory(rows);
    const filtered=removeTrailingProvisionalRows(
      cleaned,
      (latest,previous)=>latest.value===0&&previous.value>0
    );
    const history=filtered.confirmed;

    if(!history.length) throw new Error(`${sourceLabel} 수위 필드를 찾지 못했습니다.`);
    const latest=history.at(-1);

    return {
      waterLevelM:latest.value,
      observedAt:latest.timestamp,
      intervalMinutes:10,
      history,
      sourceLabel,
      live:true,
      provisionalIgnored:filtered.ignored
    };
  }
  function parseDam(doc){
    const rows=contentRecords(doc).map(node=>{
      const timestamp=parseApiTimestamp(nodeText(node,['ymdhm','obstm','tm','time']));
      const inflow=num(nodeText(node,['inf','inflow','infl']));
      const outflow=num(nodeText(node,['tototf','outflow','totoutf','totot']));
      return timestamp&&inflow!==null&&outflow!==null?{timestamp,time:timeLabel(timestamp),inflow,outflow}:null;
    }).filter(Boolean);

    const cleaned=cleanHistory(rows);
    const filtered=removeTrailingProvisionalRows(
      cleaned,
      (latest,previous)=>
        latest.inflow===0&&
        latest.outflow===0&&
        (previous.inflow>0||previous.outflow>0)
    );
    const history=filtered.confirmed;

    if(!history.length) throw new Error('팔당댐 유입·방류 필드를 찾지 못했습니다.');
    const latest=history.at(-1);

    return {
      inflowCms:latest.inflow,
      outflowCms:latest.outflow,
      observedAt:latest.timestamp,
      intervalMinutes:10,
      history,
      sourceLabel:'팔당댐 수문자료',
      live:true,
      provisionalIgnored:filtered.ignored
    };
  }
  async function loadHydrology(){
    const s=getSettings();
    if(!isConfigured()) throw new Error('수문 URL 3개가 아직 등록되지 않았습니다.');
    const [paldangDoc,jamsuDoc,hangangDoc]=await Promise.all([
      fetchXml(s.paldangUrl),fetchXml(s.jamsuUrl),fetchXml(s.hangangUrl)
    ]);
    const paldang=parseDam(paldangDoc);
    const jamsuBridge=parseWaterLevel(jamsuDoc,'잠수교 수위');
    const hangangBridge=parseWaterLevel(hangangDoc,'한강대교 수위');
    const warnings=[];

    if(paldang.provisionalIgnored?.length){
      const ignored=paldang.provisionalIgnored.at(-1);
      warnings.push(
        `팔당댐 ${timeLabel(ignored.timestamp)} 미확정 0값 제외 · ${timeLabel(paldang.observedAt)} 확정자료 유지`
      );
    }
    if(jamsuBridge.provisionalIgnored?.length){
      const ignored=jamsuBridge.provisionalIgnored.at(-1);
      warnings.push(
        `잠수교 ${timeLabel(ignored.timestamp)} 미확정 0값 제외 · ${timeLabel(jamsuBridge.observedAt)} 확정자료 유지`
      );
    }
    if(hangangBridge.provisionalIgnored?.length){
      const ignored=hangangBridge.provisionalIgnored.at(-1);
      warnings.push(
        `한강대교 ${timeLabel(ignored.timestamp)} 미확정 0값 제외 · ${timeLabel(hangangBridge.observedAt)} 확정자료 유지`
      );
    }

    return {
      paldang,
      jamsuBridge,
      hangangBridge,
      warnings,
      fetchedAt:new Date().toISOString()
    };
  }
  async function testUrl(type,rawUrl){
    const doc=await fetchXml(rawUrl);
    return type==='paldang'?parseDam(doc):parseWaterLevel(doc,type==='jamsu'?'잠수교 수위':'한강대교 수위');
  }
  window.HRFCO={getSettings,saveSettings,clearSettings,isConfigured,isSharedConfigured,loadHydrology,testUrl,updateTimeWindow};
})();
