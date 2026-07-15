/**
 * 한강버스 통합 대시보드용 Google Apps Script 백엔드 골조 V2
 * 수문 10분, 기상예보 1시간, 조석 이벤트 시각을 포함한 JSON 계약입니다.
 */
function doGet() {
  var output;
  try {
    output = getDashboardData_();
  } catch (err) {
    output = { error: true, message: String(err), meta: { generatedAt: new Date().toISOString() } };
  }
  return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
}

function getDashboardData_() {
  var props = PropertiesService.getScriptProperties();
  var demoMode = props.getProperty('DEMO_MODE') !== 'false';
  if (demoMode) return buildDemoPayload_();
  return buildLivePayload_(props);
}

function buildLivePayload_(props) {
  var required = ['HRFCO_SERVICE_KEY','HRFCO_WATERLEVEL_URL_TEMPLATE','HRFCO_DAM_URL_TEMPLATE'];
  required.forEach(function(k){ if (!props.getProperty(k)) throw new Error('스크립트 속성 누락: '+k); });

  var jamsuRows = fetchXmlFlexible_(fillTemplate_(props.getProperty('HRFCO_WATERLEVEL_URL_TEMPLATE'), {
    key: props.getProperty('HRFCO_SERVICE_KEY'), obsCode: '1018680'
  }));
  var hangangRows = fetchXmlFlexible_(fillTemplate_(props.getProperty('HRFCO_WATERLEVEL_URL_TEMPLATE'), {
    key: props.getProperty('HRFCO_SERVICE_KEY'), obsCode: '1018683'
  }));
  var paldangRows = fetchXmlFlexible_(fillTemplate_(props.getProperty('HRFCO_DAM_URL_TEMPLATE'), {
    key: props.getProperty('HRFCO_SERVICE_KEY'), obsCode: '1012110'
  }));

  var now = new Date();
  return {
    meta: { generatedAt: now.toISOString(), mode: 'live' },
    alerts: [],
    hydrology: {
      jamsuBridge: parseWaterRows_(jamsuRows, '잠수교 수위'),
      hangangBridge: parseWaterRows_(hangangRows, '한강대교 수위'),
      paldang: parseDamRows_(paldangRows)
    },
    weather: {
      rainfall: { west: emptyRain_(now), east: emptyRain_(now) },
      windStations: []
    },
    tide: emptyTide_(now),
    health: [
      health_('수문정보', now, 10), health_('기상관측', null, 10),
      health_('기상예보', null, 60), health_('조석정보', null, 360)
    ]
  };
}

function fetchXmlFlexible_(url) {
  var res = UrlFetchApp.fetch(url, {muteHttpExceptions:true, followRedirects:true});
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) throw new Error('API HTTP '+res.getResponseCode());
  return xmlToRows_(XmlService.parse(res.getContentText('UTF-8')).getRootElement());
}

function xmlToRows_(root) {
  var rows=[];
  function walk(el) {
    var children=el.getChildren();
    if (!children.length) return;
    var leaf=children.every(function(c){return c.getChildren().length===0;});
    if (leaf) {
      var row={}; children.forEach(function(c){row[c.getName()]=c.getText();}); rows.push(row); return;
    }
    children.forEach(walk);
  }
  walk(root); return rows;
}

function parseWaterRows_(rows, label) {
  var parsed=rows.map(function(r){
    var raw=pick_(r,['ymdhm','tm','obstm','time']);
    return { time: formatHm_(raw), timestamp: compactToIso_(raw), value: num_(pick_(r,['wl','waterlevel','value'])) };
  }).filter(function(x){return isFinite(x.value);});
  if (!parsed.length) throw new Error(label+' XML 태그 확인 필요');
  parsed=parsed.slice(-13);
  var latest=parsed[parsed.length-1];
  return { waterLevelM:latest.value, observedAt:latest.timestamp, intervalMinutes:10, history:parsed, sourceLabel:label };
}

function parseDamRows_(rows) {
  var parsed=rows.map(function(r){
    var raw=pick_(r,['ymdhm','tm','obstm','time']);
    return {
      time:formatHm_(raw), timestamp:compactToIso_(raw),
      inflow:num_(pick_(r,['inf','inflow','iqty','inflowqty'])),
      outflow:num_(pick_(r,['sfw','outflow','tototf','oqty','outflowqty']))
    };
  }).filter(function(x){return isFinite(x.inflow)||isFinite(x.outflow);});
  if (!parsed.length) throw new Error('팔당댐 XML 태그 확인 필요');
  parsed=parsed.slice(-13);
  var latest=parsed[parsed.length-1];
  return { inflowCms:latest.inflow, outflowCms:latest.outflow, observedAt:latest.timestamp, intervalMinutes:10, history:parsed, sourceLabel:'팔당댐 수문자료' };
}

function compactToIso_(v) {
  var s=String(v||'').replace(/\D/g,'');
  if (s.length < 12) return new Date().toISOString();
  var d=new Date(Number(s.slice(0,4)),Number(s.slice(4,6))-1,Number(s.slice(6,8)),Number(s.slice(8,10)),Number(s.slice(10,12)));
  return d.toISOString();
}
function formatHm_(v) {
  var s=String(v||'').replace(/\D/g,'');
  return s.length>=12 ? s.slice(8,10)+':'+s.slice(10,12) : '-';
}
function pick_(obj, keys) { for (var i=0;i<keys.length;i++) if (obj[keys[i]]!==undefined) return obj[keys[i]]; return ''; }
function num_(v) { return Number(String(v).replace(/,/g,'')); }
function fillTemplate_(tpl, values) { return tpl.replace(/\{(\w+)\}/g,function(_,k){return encodeURIComponent(values[k]||'');}); }
function health_(name, date, interval) { return {name:name,updatedAt:date?date.toISOString():null,intervalMinutes:interval,status:date?'normal':'pending'}; }

function emptyRain_(now) {
  var timeline=[];
  for(var i=-2;i<=8;i++){
    var d=new Date(now.getTime()+i*3600000);
    timeline.push({time:d.toISOString(),label:Utilities.formatDate(d,Session.getScriptTimeZone(),'HH:mm'),amount:0,type:i<0?'observed':i===0?'current':'forecast'});
  }
  return {observedAt:now.toISOString(),forecastIssuedAt:null,currentRate:0,next3h:0,next6h:0,next12h:0,next24h:0,timeline:timeline,observationIntervalMinutes:60,forecastIntervalMinutes:60};
}
function emptyTide_(now) {
  return {referenceAt:now.toISOString(),updatedAt:null,phase:'자료 연결 필요',overlapRisk:'확인',previousHigh:{time:null,heightCm:null},previousLow:{time:null,heightCm:null},nextHigh:{time:null,heightCm:null},nextLow:{time:null,heightCm:null},nextAfterHigh:{time:null,heightCm:null},comparisonInterval:'event'};
}

function buildDemoPayload_() {
  // 실제 데모 데이터는 프론트엔드 data/demo-data.js와 동일 계약을 사용합니다.
  var now=new Date();
  var times=[],j=[],h=[],d=[];
  for(var i=12;i>=0;i--){
    var t=new Date(now.getTime()-i*600000); var label=Utilities.formatDate(t,Session.getScriptTimeZone(),'HH:mm');
    times.push(t); j.push({time:label,timestamp:t.toISOString(),value:4.22-(i*0.02)});
    h.push({time:label,timestamp:t.toISOString(),value:3.18-(i*0.013)});
    d.push({time:label,timestamp:t.toISOString(),inflow:1940-i*35,outflow:1860-i*32});
  }
  return {
    meta:{generatedAt:now.toISOString(),mode:'demo',note:'Apps Script V2 데모'},alerts:[],
    hydrology:{
      jamsuBridge:{waterLevelM:j[j.length-1].value,observedAt:now.toISOString(),intervalMinutes:10,history:j,sourceLabel:'잠수교 수위'},
      hangangBridge:{waterLevelM:h[h.length-1].value,observedAt:now.toISOString(),intervalMinutes:10,history:h,sourceLabel:'한강대교 수위'},
      paldang:{inflowCms:1940,outflowCms:1860,observedAt:now.toISOString(),intervalMinutes:10,history:d,sourceLabel:'팔당댐 수문자료'}
    },
    weather:{rainfall:{west:emptyRain_(now),east:emptyRain_(now)},windStations:[]},
    tide:emptyTide_(now),
    health:[health_('수문정보',now,10),health_('기상관측',null,10),health_('기상예보',null,60),health_('조석정보',null,360)]
  };
}
