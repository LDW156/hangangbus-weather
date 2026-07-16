/*
 * 한강버스 공용 기상 설정
 *
 * 인증키는 GitHub에 넣지 않습니다.
 * Cloudflare Worker의 Secret `KMA_AUTH_KEY`에만 저장합니다.
 */
window.HANGANG_WEATHER_CONFIG = {
  ENABLED: true,
  PROXY_BASE: "https://hangangbus-api.akchdleodns.workers.dev"
};
