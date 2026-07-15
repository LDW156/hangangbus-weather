window.HANGANG_CONFIG = {
  APP_NAME: '한강버스 운항환경 통합 대시보드',
  DATA_MODE: 'demo', // demo | live
  API_URL: '',       // Google Apps Script Web App URL
  REFRESH_MS: 300000,
  SHOW_DEMO_CONTROLS: true,
  STRUCTURE_HEIGHT_M: 11.76,
  THRESHOLDS: {
    jamsu: {
      cautionLevelM: 4.10,
      stopLevelM: 4.46,
      cautionClearanceM: 7.66,
      stopClearanceM: 7.30
    },
    paldang: {
      eastStopCms: 2000,
      eastCautionCms: 1800,
      westStopCms: 3000,
      westCautionCms: 2700
    },
    // 아래 풍속값은 데모 표시용 초안입니다. 회사 확정 기준으로 수정해야 합니다.
    wind: {
      cautionMs: 8,
      stopMs: 12,
      gustCautionMs: 14,
      gustStopMs: 20
    },
    rainfall: {
      cautionHourlyMm: 20,
      stopHourlyMm: 30
    },
    stale: {
      weatherMinutes: 30,
      hydrologyMinutes: 20,
      tideMinutes: 720
    }
  }
};
