# 한강버스 대시보드 시인성·갱신 개선 v54

## 핵심 수정
- 상단 `최신 데이터 업데이트` 버튼 추가
- 5분 자동갱신 유지, 모바일 복귀 시 오래된 경우 자동갱신
- `판단 기준`을 `화면 갱신`과 `판단 산출`로 분리
- 잠수교·팔당 API 조회 종료시각을 현재 10분 단위까지 확장
- 기상 실황 API를 최신 후보시각부터 조회하고 없으면 이전 시각으로 자동 후퇴
- 강수 카드 글자 확대, 최근 실황과 향후 예보시간 분리
- 강수확률 문구를 `강수확률 20%` 형태로 표시
- 풍향을 나침반과 유색 화살표로 표시
- 현재 및 1·2·3·4시간 후 풍향·풍속 표시
- 서울 ASOS(108) 순간풍속 참고값 연결 지원

## 추가 API 활용신청
순간풍속을 실제로 표시하려면 기상청 API허브에서 다음 항목을 추가 신청합니다.
- 지상관측 → 지상 관측자료 조회 → 시간자료 API

승인 전에도 나머지 기상·수문 기능은 정상 작동하며 순간풍속만 `연결 대기`로 표시됩니다.

## Cloudflare
`cloudflare-worker.js` 전체 코드로 기존 Worker를 교체하고 Deploy합니다.
`/health`에서 `version: 54`, routes에 `/asos`가 표시되어야 합니다.

## GitHub 업로드
- app.js
- kma.js
- hrfco.js
- styles.css
- index.html
- service-worker.js

기존 `shared-config.js`, `weather-config.js`, `config.js`는 덮어쓰지 않습니다.

접속: https://ldw156.github.io/hangangbus-weather/?v=54
