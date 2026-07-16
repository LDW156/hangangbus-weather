/*
 * 한강버스 조석 API 설정 v65
 * 기상·조석 통합 Worker를 사용하므로 기상 설정의 Worker 주소를 자동으로 공유합니다.
 */
(() => {
  const weather = window.HANGANG_WEATHER_CONFIG || {};
  const proxyBase = String(weather.PROXY_BASE || '')
    .trim()
    .replace(/\/$/, '');

  window.HANGANG_OCEAN_CONFIG = {
    ENABLED: weather.ENABLED !== false,
    PROXY_BASE: proxyBase,
    OBS_CODE: 'DT_0001'
  };
})();
