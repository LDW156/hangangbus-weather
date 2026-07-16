/*
 * 한강버스 바다누리 조석 API 설정
 * 인증키는 GitHub에 저장하지 않고 Cloudflare Worker Secret에 저장합니다.
 */
window.HANGANG_OCEAN_CONFIG = {
  ENABLED: true,
  PROXY_BASE: 'https://hangangbus-ocean.akchdleodns.workers.dev',
  OBS_CODE: 'DT_0001'
};
