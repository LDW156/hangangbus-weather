# 기상청 Cloudflare 중계 패치 v51

## 원인
기상청 API허브는 GitHub Pages 브라우저의 교차 출처 JavaScript 요청을 허용하지 않아
`Failed to fetch` CORS 오류가 발생합니다.

## 구조
기상청 API허브 → Cloudflare Worker → GitHub Pages·모바일

## Cloudflare 설정
1. 기존 `hangangbus-api` Worker의 코드를 `cloudflare-worker.js` 전체 내용으로 교체
2. Worker 설정 → Variables and Secrets
3. Secret 추가
   - 이름: `KMA_AUTH_KEY`
   - 값: 기상청 API허브 인증키
4. Deploy

## Worker 확인
아래 주소 접속:
`https://hangangbus-api.akchdleodns.workers.dev/health`

정상 예:
```json
{
  "ok": true,
  "keyConfigured": true
}
```

## GitHub 업로드
아래 파일을 저장소 최상단에 덮어쓰기:
- weather-config.js
- kma.js
- index.html
- service-worker.js

배포 후:
`https://ldw156.github.io/hangangbus-weather/?v=51`

## 보안
기존 `weather-config.js`에 인증키를 올렸다면 GitHub 기록에 남아 있을 수 있습니다.
기능 확인 후 기상청 API허브에서 인증키 재발급을 권장합니다.
