# 인증/사용자관리 v93.0
1. D1 `hangangbus-auth` 생성
2. wrangler.jsonc에 database_id와 ADMIN_EMAIL 입력
3. init_auth_db.bat 실행
4. deploy_auth_worker.bat 실행
5. Cloudflare Access에서 사이트와 Auth Worker 보호
6. 루트 auth-config.js에 apiBase 입력 후 enabled:true

현재 단계에서는 프런트엔드 가짜 비밀번호를 쓰지 않습니다. 실제 접근 차단은 Access 적용 시 활성화합니다.
