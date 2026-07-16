# 기상청 공용 자동연결 패치 v50

## 적용되는 실데이터
- 선착장별 현재 풍향·풍속
- 1시간 후·3시간 후 풍향·풍속 예보
- 현재 1시간 강수량
- 향후 3·6·12·24시간 예상 강수량
- 수도권 특보사항
- 예비특보
- 각 관측·예보·발표 시각

## GitHub 설정
`weather-config.js`에서 아래 값만 실제 기상청 API허브 인증키로 교체합니다.

```javascript
AUTH_KEY: "발급받은_기상청_API허브_인증키"
```

이후 PC·모바일에서 별도 입력 없이 자동 연결됩니다.

## 업로드
아래 파일을 GitHub 저장소 최상단에 덮어씁니다.
- weather-config.js
- kma.js
- app.js
- config.js
- index.html
- styles.css
- service-worker.js

기존 `shared-config.js`는 수문 URL이 들어 있으므로 덮어쓰지 마십시오.

## 접속
https://ldw156.github.io/hangangbus-weather/?v=50

## 주의
GitHub Pages의 JavaScript는 공개됩니다. 인증키도 방문자가 확인할 수 있습니다.
데모·내부 시범운영용으로 사용하고, 정식 운영 단계에서는 국내 중계 서버를 검토해야 합니다.
