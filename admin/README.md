# Admin Console

플랫폼 운영자 한 명이 전체 카페의 운영 상태와 오늘 사용량을 확인하는 무빌드 정적 앱이다.

## AI 작업 계약

- 화면 코드는 이 디렉터리, API와 인증은 server/src/routes/admin.js에서 관리한다.
- 사장님 JWT와 관리자 JWT를 합치지 않는다. 모든 보호 API는 requireAdmin을 사용한다.
- 활성은 last_heartbeat_at이 5분 이내, 오늘 사용은 KST 오늘 heartbeat, 미사용은 heartbeat 없음이다.
- 토큰은 sessionStorage에만 저장하고 관리자 비밀번호를 코드나 로그에 남기지 않는다.
- 카페 삭제는 종속 데이터를 함께 지우므로 이름 재입력 확인을 유지한다. 가능하면 삭제보다 정지를 우선한다.
- UI 변경 후 node --check admin/admin.js와 npm run test:unit --prefix server를 실행한다.

## 파일

- index.html: 관리자 진입 문서
- admin.js: 로그인, 목록, 지도, 정지와 삭제 동작
- admin.css: 관리자 전용 스타일

서버 실행 후 /admin에서 접근한다. ADMIN_PASSWORD가 없으면 로그인 API는 503을 반환한다.
