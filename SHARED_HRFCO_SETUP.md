# 모바일 즉시 사용용 공용 HRFCO 설정

## 목적
관리자가 GitHub의 `shared-config.js`에 HRFCO URL 3개를 한 번만 등록하면,
PC와 모바일 등 모든 방문자가 별도 입력 없이 수문 실데이터를 바로 확인합니다.

## 설정
`shared-config.js`에서 아래 세 줄의 값만 실제 URL로 교체합니다.

- `PALDANG_URL`
- `JAMSU_URL`
- `HANGANG_URL`

URL은 한강홍수통제소 API 호출 화면에서 정상 XML이 출력된 전체 호출 URL입니다.
앱은 URL 안의 12자리 시작·종료시각을 자동으로 최근 약 2시간 범위로 바꿉니다.

## 주의
GitHub Pages의 JavaScript 파일은 공개됩니다. URL에 포함된 인증키도 사용자가
개발자도구나 소스에서 확인할 수 있습니다.

- 빠른 데모·내부 시범 운영: 이 방식 사용 가능
- 인증키 비공개 정식 운영: 국내 중계 서버 필요

## 업로드 파일
- `shared-config.js`
- `hrfco.js`
- `index.html`
- `service-worker.js`

기존 파일을 같은 이름으로 덮어쓴 뒤 배포가 끝나면 모바일에서도 즉시 자동 연결됩니다.
