/*
 * 한강버스 공용 API 설정
 *
 * 이 파일에 URL 3개를 한 번만 입력해 GitHub에 올리면
 * PC·모바일 등 모든 기기에서 별도 입력 없이 자동 연결됩니다.
 *
 * 주의: GitHub Pages의 JavaScript 파일은 방문자가 열람할 수 있으므로
 * 아래 URL에 포함된 HRFCO 인증키도 공개될 수 있습니다.
 */
window.HANGANG_SHARED_CONFIG = {
  HRFCO: {
    ENABLED: true,

    // 한강홍수통제소 API 호출 화면에서 생성한 전체 URL을 각각 붙여넣으십시오.
    PALDANG_URL: "PASTE_PALDANG_URL_HERE",
    JAMSU_URL: "PASTE_JAMSU_URL_HERE",
    HANGANG_URL: "PASTE_HANGANG_URL_HERE",

    // 공용 URL 설정이 완료되면 일반 사용자 화면에서 설정 버튼을 숨깁니다.
    SHOW_SETTINGS_BUTTON: false
  }
};
