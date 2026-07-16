window.HANGANG_CONFIG = {
  APP_NAME: '한강버스 운항환경 통합 대시보드',
  DATA_MODE: 'hybrid',
  REFRESH_MS: 300000,
  SHOW_DEMO_CONTROLS: false,
  STRUCTURE_HEIGHT_M: 11.76,
  HRFCO: {
    ENABLED: true,
    STORAGE_KEY: 'hangangbus_hrfco_urls_v1',
    HISTORY_MINUTES: 130,
    INTERVAL_MINUTES: 10
  },
  KMA: {
    ENABLED: true,
    STORAGE_KEY: 'hangangbus_kma_settings_v1',
    OBSERVATION_INTERVAL_MINUTES: 60,
    FORECAST_INTERVAL_MINUTES: 60
  },
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
    wind: {
      cautionMs: 8,
      stopMs: 12
    },
    rainfall: {
      stop3hMm: 90,
      stop12hMm: 180
    },
    alerts: {
      stopKeywords: [
        '호우경보',
        '강풍주의보',
        '강풍경보',
        '태풍주의보',
        '태풍경보'
      ]
    },
    stale: {
      weatherMinutes: 30,
      hydrologyMinutes: 20,
      tideMinutes: 720
    }
  }
};
