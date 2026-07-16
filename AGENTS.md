# AGENTS.md

AI 도구(Claude Code · Codex · Gemini 등)와 사람 기여자가 공통으로 따르는 **단일 계약**이다.
도구별 파일(CLAUDE.md, GEMINI.md, .cursor/rules)은 이 파일을 가리키는 포인터일 뿐, 규칙은 여기에만 존재한다.

프로젝트: 카페 손님이 QR로 음악을 신청하고 사장님이 데스크톱에서 큐를 관리·재생하는 실시간 플랫폼.
구조·재생 파이프라인·DB는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), API는 [docs/API.md](docs/API.md), LLM 기능은 [docs/LLM_FEATURES.md](docs/LLM_FEATURES.md), AI 수정 가드레일은 [docs/AI_CHANGE_GUARDRAILS.md](docs/AI_CHANGE_GUARDRAILS.md), 개발·배포는 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## 작업 흐름

1. **읽기** — 변경 대상의 실제 코드(라우트·서비스·마이그레이션)를 먼저 확인한다. 추측하지 않는다.
2. **설계** — 선택지가 있으면 트레이드오프를 짧게 정리한다. 스키마 변경·삭제처럼 되돌리기 어려운 작업은 먼저 확인받는다.
3. **계약 확인** — 상태값·라우터 순서·KST·SQL raw·LLM 동작을 바꾸는 경우 [docs/AI_CHANGE_GUARDRAILS.md](docs/AI_CHANGE_GUARDRAILS.md)를 먼저 확인한다.
4. **구현** — 논리 단위로 작게 나누고, 단계마다 검증한다.
5. **커밋** — [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md) 형식. 논리적 변경 1개 = 커밋 1개. scope는 필수다(`fix(server):` — `fix:`는 위반).
6. **병합** — 다른 도구가 만든 브랜치를 병합하기 전에 그 브랜치 커밋들이 컨벤션을 지켰는지 확인한다. 위반 커밋이 섞여 있으면 일반 merge 대신 **squash 병합**으로 컨벤션 준수 커밋 하나만 main에 남긴다 — 일반 merge는 브랜치 커밋 전부가 push 범위에 들어와 CI 커밋 린트에 걸린다.

## 커밋 전 체크리스트

- [ ] 커밋 메시지는 `COMMIT_CONVENTION.md` 형식: `type(scope): 제목` + `Why:` + bullet + `Decision:` + `🤖 Generated with ...`
- [ ] `node --check <file>` 통과
- [ ] 로직 변경이면 테스트 통과: `npm run test:unit --prefix server` (DB 불필요) / `npm test --prefix server` (통합, Postgres 필요)
- [ ] `customer/src` 수정 시 `npm run build --prefix customer` 통과
- [ ] `owner/src` 또는 `owner/electron` 수정 시 `npm run build --prefix owner` 통과
- [ ] 상태값·라우터 순서·KST·SQL raw·LLM 동작을 바꿨다면 [docs/AI_CHANGE_GUARDRAILS.md](docs/AI_CHANGE_GUARDRAILS.md)의 관련 계약과 테스트를 갱신
- [ ] 마이그레이션·DB 변경이면 **실제 스키마로 검증** — 과거 `MIN(uuid)` 장애는 정수 PK로 가정한 테스트가 통과해서 놓쳤다
- [ ] 라우트 추가·변경 시 `docs/API.md` 갱신 — CI의 드리프트 테스트가 누락을 잡는다
- [ ] 시크릿·토큰이 코드·커밋·로그에 없음

## 저장소 불변식 (바꾸지 말 것)

- **공유 DB에 로컬 `migrate` 금지** — 배포 startCommand가 자동 실행한다. 마이그레이션은 up/down 모두 구현하고, 데이터 삭제 대신 상태 변경(예: `rejected`)으로 보존한다.
- **`recommendations.id`는 UUID** — 집계에 `MIN/MAX(id)` 금지, `ROW_NUMBER() OVER (... ORDER BY)` 사용.
- **클라이언트 IP는 `req.ip`** — X-Forwarded-For 직접 파싱 금지.
- **사용자 입력 URL fetch는 `safeAxiosGet` 경유** (SSRF 방어). 익명 쓰기 엔드포인트에는 visitor+IP rate limiter를 붙인다.
- **라우트 마운트 순서** — owner 라우터가 public보다 먼저여야 인증 핸들러가 경로를 가져간다 (`server/app.js`).
- **slug는 불변이 아니다** — `PUT /cafes/me/slug`로 재발급·변경 가능(아크릴 QR 사전 제작 지원). slug 변경 시 JWT의 slug가 옛 값으로 남으므로 반드시 새 토큰을 응답에 포함해 클라이언트가 교체해야 한다. slug를 캐시하거나 불변 가정하는 코드를 추가하지 않는다.
- **서버 상태값·플랫폼·한도·시간 정책은 constants 경유** — `server/src/constants/*`와 `server/src/db/sql-fragments.js`를 먼저 확인한다.
- **프론트 상태값·플랫폼 표시도 constants 경유** — `owner/src/constants/*`, `customer/src/constants/*`를 먼저 확인한다.
- **LLM 음악 필터는 fail-closed** — LLM 실패 시 신청곡을 통과시키지 않고 `error_rejected`로 기록한다.
- **app.js / server.js 분리 유지** — 테스트가 `app.js`를 import한다.
- **날짜·시간대 집계는 KST 유틸 경유** — 서버는 `utils/kst.js`와 `constants/time-policy.js`, owner 화면은 `owner/src/utils/kst.js`를 사용한다. UTC 자정을 직접 계산하지 않는다.
- **한국어 커밋·주석, 영어 식별자.**
- **화면 검증이 불가능한 환경에서 UI 스타일 대량 일괄 변경 금지** — 컴포넌트 단위로 나눠 확인하며 진행한다.
