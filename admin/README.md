# Admin Console

플랫폼 운영자가 전체 카페의 운영 상태와 사용량을 확인하는 무빌드 정적 앱이다. 화면은 이 디렉터리(`index.html`·`admin.js`·`admin.css`), API와 인증은 `server/src/routes/admin.js`에 있고 엔드포인트 상세는 [docs/API.md](../docs/API.md#운영자--admin)를 따른다. 서버 실행 후 `/admin`에서 접근하며 `ADMIN_PASSWORD`가 없으면 로그인 API는 503이다.

## 작업 계약

- 사장님 JWT와 관리자 JWT를 합치지 않는다. 모든 보호 API는 `requireAdmin`을 사용한다.
- 토큰은 sessionStorage에만 저장하고 관리자 비밀번호를 코드나 로그에 남기지 않는다.
- 로그인은 IP별 15분 10회, 서비스 전체 15분 50회 실패 시 제한하며 API가 준 남은 시간을 표시한다.
- 카페 삭제는 종속 데이터를 함께 지우므로 이름 재입력 확인을 유지하고, 가능하면 삭제보다 정지를 우선한다.
- UI 변경 후 `node --check admin/admin.js`와 `npm run test:unit --prefix server`를 실행한다.

## 상태 정의

- 활성은 `last_heartbeat_at` 5분 이내, 오늘 사용은 KST 오늘 heartbeat, 미사용은 heartbeat 없음이다.
- `today_unique_browsers`는 KST 기준 QR 페이지에 접속한 중복 제거 익명 브라우저 수다. 계정·사람·기기 수로 해석하지 않는다.
- 카페별 통계는 기존 `stats.service`를 재사용하며 목록에서 카페를 선택해 확인한다.

## AI 감사와 라벨링

- 카페별 현재 프롬프트, 설정 변경 이력, 곡별 승인·거절과 판단 당시 프롬프트를 50건씩 페이지로 감사한다.
- 판단에는 정책 일치 여부를, 곡에는 확인한 아티스트·템포·분위기·사운드·리듬·보컬·장르·메모를 구조화해 기록한다. 곡 버전과 메타데이터 충분성은 화면에서 묻지 않으며 신규 메타데이터 충분성은 미확인 `null`로 저장한다. 사람 라벨은 큐 상태와 LLM 판단을 바꾸지 않는다.
- 동일한 플랫폼 원본 곡의 기존 특성 라벨은 선택된 상태로 복원하고 저장 시각을 표시한다. 매장 정책 판단은 자동 복사하지 않는다.
- 음악 라벨링은 판단 당시 매장 정책 아래에 AI 승인·거절 결과를 표시한다. 제목에 `Playlist` 또는 `플리`가 포함된 항목은 큐와 집계에서 제외한다.
- 헤더에서 관리자 세션을 유지한 채 [`필터 테스트`](../music-filter-lab/README.md)와 [`음악 라벨링`](../music-labeling-lab/README.md)으로 이동한다. 정책 검수와 곡 라벨이 모두 저장된 항목만 완료로 센다.

라벨 값과 수집 정책은 [docs/LLM_FILTER.md](../docs/LLM_FILTER.md#평가-데이터셋)가 기준이다.
