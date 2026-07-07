# AGENTS.md

AI 도구(Claude Code · Codex · Gemini 등)로 이 저장소를 작업할 때 지켜야 할 규칙이다. 사람 기여자도 똑같이 따른다.

이 파일은 어떤 도구에도 얽매이지 않는 **공통 계약(contract)**이다. 도구별 설정(CLAUDE.md, GEMINI.md, .cursor/rules 등)은 이 파일을 참조하는 얇은 어댑터로만 유지한다.

---

## 프로젝트 한 줄 요약

카페 손님이 QR로 음악을 신청하고 사장님이 데스크톱에서 큐를 관리·재생하는 실시간 플랫폼. Express + Postgres 백엔드, React SPA(손님·사장님), Electron 데스크톱. 상세는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 작업 흐름

1. **컨텍스트 파악** — 관련 코드를 먼저 읽는다. 라우트 변경이면 실제 라우트·서비스·마이그레이션을 확인하고 추측하지 않는다.
2. **설계** — 선택지가 있으면 대안과 트레이드오프를 짧게 정리한 뒤 진행한다. 스키마 변경이나 삭제처럼 되돌리기 어려운 작업은 먼저 확인을 받는다.
3. **구현** — 논리 단위로 작게 나눠서 작업하고, 각 단계마다 구문 검사와 테스트로 검증한다.
4. **검증** — 커밋 전 `node --check`, 관련 테스트, 필요 시 부팅 스모크.

---

## 필수 규칙

### 커밋
- **[COMMIT_CONVENTION.md](COMMIT_CONVENTION.md)를 따른다.** `type(scope): 제목` + `Why:` + 본문 + `Decision:` + `🤖 Generated` 마커.
- 논리적 변경 1개 = 커밋 1개. 보안 수정과 UI 수정을 한 커밋에 섞지 않는다.

### 검증 없이 "됐다"고 하지 않기
- 코드 변경 후 최소한 `node --check`. 로직 변경이면 테스트를 돌린다.
- **마이그레이션과 DB 로직은 실제 스키마로 검증한다.** 과거 `MIN(uuid)` 장애는 PK가 정수라고 가정한 로컬 테스트에서 통과하는 바람에 놓쳤다. 반드시 실제 컬럼 타입을 확인한다.

### 공유 DB 보호
- Railway 등 공유 DB에 로컬에서 `db:migrate`를 실행하지 않는다. 배포 startCommand가 자동 실행한다.
- 마이그레이션은 up/down을 모두 구현한다. 데이터를 지워야 하는 작업은 삭제 대신 상태 변경(예: `rejected` 마킹)으로 원본을 보존한다.

### owner 번들 동기화
- `owner/src`를 수정한 뒤에는 `cd owner && npm run build`로 `server/public/owner/`를 다시 빌드해 커밋한다. 이 번들은 Railway fallback용으로 저장소에 들어가므로 소스와 어긋나선 안 된다.

### 보안 기본선
- 사용자 입력 URL fetch는 반드시 `safeAxiosGet` 경유 (SSRF).
- 클라이언트 IP는 `req.ip` (X-Forwarded-For 직접 파싱 금지).
- 익명 쓰기 엔드포인트는 visitor+IP rate limiter를 붙인다.
- 시크릿·토큰을 코드·커밋·로그에 남기지 않는다.

---

## 이 저장소 고유 패턴

- **라우트 마운트 순서** — owner 라우터가 public보다 먼저 마운트돼야 인증 핸들러가 경로 매칭을 먼저 가져간다. `server/app.js`의 순서를 바꾸지 않는다.
- **recommendations.id는 UUID** — 집계에 `MIN/MAX(id)` 금지. `ROW_NUMBER() OVER (... ORDER BY)` 사용.
- **KST 기준 통계** — 날짜 경계와 시간대 집계에는 `utils/kst.js`를 쓴다. UTC 자정을 직접 계산하지 않는다.
- **상태 전이** — 종료 상태(played/skipped/rejected)에서 다른 상태로 되돌리는 전이는 서비스 레이어에서 이미 막아 두었다.
- **app.js / server.js 분리** — 테스트가 `app.js`를 import한다. 앱 조립 로직을 server.js로 다시 합치지 않는다.
- **한국어 커밋·주석** — 코드 주석과 커밋 메시지는 한국어로, 코드 식별자는 영어로 쓴다.

---

## 테스트

```bash
npm run test:unit --prefix server   # 빠른 확인 (DB 불필요)
npm test --prefix server            # 통합 포함 (Postgres 필요)
```
자세한 셋업은 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#테스트).

---

## 하지 말 것

- 시크릿을 하드코딩하거나 로그에 남기기
- 공유 DB에 로컬 마이그레이션 실행
- 검증 없이 완료 보고
- 여러 논리 변경을 한 커밋에 뭉치기
- owner 소스만 고치고 번들 리빌드 누락
- 화면 확인이 불가능한 환경에서 UI 스타일을 대량 일괄 변경 (컴포넌트 단위 + 검증으로)
