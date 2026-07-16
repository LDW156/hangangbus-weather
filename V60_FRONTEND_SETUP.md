# 공식 로고·그래프 10분 툴팁 v60

## 변경 내용
- 사용자가 제공한 한강버스 공식 로고로 상단 임시 HB 심볼 교체
- 잠수교 그래프: 마우스 또는 터치 위치의 가장 가까운 10분 자료 표시
  - 잠수교 수위
  - 통과높이
  - 10분 전 대비 수위변화
- 팔당댐 그래프: 가장 가까운 10분 자료 표시
  - 유입량
  - 방류량
  - 유입-방류
  - 10분 전 대비 방류량 변화
- 그래프 아래 시간축은 기존처럼 간격을 줄여 표시하지만, 모든 10분 자료는 툴팁으로 조회 가능

## GitHub 업로드
압축을 풀고 다음 파일과 폴더를 저장소 최상단에 덮어씁니다.

- app.js
- styles.css
- index.html
- service-worker.js
- assets/hangangbus-logo.png

다음 파일은 수정하지 않습니다.

- config.js
- kma.js
- hrfco.js
- shared-config.js
- weather-config.js

## 접속
https://ldw156.github.io/hangangbus-weather/?v=60
