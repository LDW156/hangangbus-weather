팔당댐 유입량 파서 수정

원인: 팔당댐 XML의 유입량 태그가 inf인데 기존 파서가 infl을 먼저 확인하여 0 또는 잘못된 값을 표시함.
수정: inf -> inflow -> infl 순서로 파싱.
적용 파일: hrfco.js, index.html, service-worker.js
