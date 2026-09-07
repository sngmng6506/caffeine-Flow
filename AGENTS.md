# AGENTS.md

사람과 AI 도구가 Caffeine Flow를 수정할 때 따르는 공통 작업 계약이다. `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`는 이 문서를 가리키는 어댑터다.

## 문서 사용 규칙

- 모든 문서를 한꺼번에 읽지 않는다. 이 문서와 수정 대상 코드·상수·테스트를 먼저 읽고, 아래 표에서 해당 작업의 문서만 추가로 읽는다.
- 여러 영역을 가로지르는 변경이면 해당 문서를 모두 읽는다.
- 외부 동작이나 계약이 바뀌면 같은 작업에서 담당 문서를 갱신한다. 동작이 같은 내부 리팩터링은 문서를 고치지 않는다.
- 한 사실은 담당 문서 한 곳에서만 설명하고 다른 문서는 링크만 둔다.
- 아직 구현하지 않을 제안은 [docs/ROADMAP.md](docs/ROADMAP.md)에만 기록한다.

전체 문서 지도는 [docs/README.md](docs/README.md)에 있다.

## 작업별 문서 라우팅

| 작업 내용 | 읽고 갱신할 문서 |
| --- | --- |
| 시스템 경계, 앱 책임, 데이터 흐름, 상태 모델 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Electron, BrowserView, 재생·종료 감지, 플랫폼 우회 | [docs/PLAYBACK.md](docs/PLAYBACK.md) |
| HTTP 라우트, 요청·응답, 인증, 상태 코드 | [docs/API.md](docs/API.md) |
| 플랫폼 운영자 콘솔 화면·상태·관리 동작 | [admin/README.md](admin/README.md) |
| 환경변수, 실행 명령, 테스트, 마이그레이션, 배포 | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| 음악 필터, 프롬프트, 모델 호출, 판단·오류 정책 | [docs/LLM_FILTER.md](docs/LLM_FILTER.md) |
| 상태값, 라우터 순서, 플랫폼, 한도, KST, SQL raw, LLM 안전, 인증·웹 보안, 마이그레이션 | [docs/AI_CHANGE_GUARDRAILS.md](docs/AI_CHANGE_GUARDRAILS.md) |
| 미구현 기능 검토·설계·우선순위 | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Markdown 문서 추가·이동·분리·재구성 | [docs/DOCUMENTATION_POLICY.md](docs/DOCUMENTATION_POLICY.md) |
| 손님 화면의 색상·레이아웃·컴포넌트·모션 | [customer/DESIGN_GUIDE.md](customer/DESIGN_GUIDE.md) |
| 손님 화면의 버튼·상태·오류 등 사용자 문구 | [customer/WRITING_GUIDE.md](customer/WRITING_GUIDE.md) |
| 사장님 화면의 색상·레이아웃·컴포넌트·모션 | [owner/DESIGN_GUIDE.md](owner/DESIGN_GUIDE.md) |
| 사장님 화면의 버튼·상태·오류 등 사용자 문구 | [owner/WRITING_GUIDE.md](owner/WRITING_GUIDE.md) |
| 커밋 작성 | [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md) |

자주 겹치는 조합:

- 추천곡 상태 전이: `ARCHITECTURE.md` + `AI_CHANGE_GUARDRAILS.md`
- AI 자동수락: `LLM_FILTER.md` + `AI_CHANGE_GUARDRAILS.md`
- Electron 재생과 서버 큐 연동: `PLAYBACK.md` + `ARCHITECTURE.md` + `AI_CHANGE_GUARDRAILS.md`
- 외부 로그인·지도·스크립트·iframe 추가: `AI_CHANGE_GUARDRAILS.md` + 실제 소비 코드
- 새 API와 환경변수: `API.md` + `DEVELOPMENT.md`

## 작업 흐름

1. **분류** — 어떤 영역과 계약을 건드리는지 판단한다.
2. **읽기** — 대상 코드와 라우팅된 문서·상수·테스트를 확인한다.
3. **경계 확인** — 상태, 라우터 순서, KST, SQL raw, LLM, 웹 보안, 마이그레이션은 가드레일을 확인한다.
4. **구현** — 논리 단위를 작게 유지하고 동작 변경과 구조 변경을 분리한다.
5. **검증** — 아래 명령으로 테스트와 빌드를 확인한다.
6. **문서** — 외부 동작이나 계약이 바뀐 경우에만 담당 문서를 갱신한다.
7. **커밋** — `type(scope): 제목` 형식과 Why/Decision을 사용한다. 커밋 규칙을 위반한 외부 브랜치는 merge 대신 squash한다.

## 코드와 문서가 다를 때

추측으로 한쪽을 따르지 않는다.

1. 실제 코드·상수·테스트·DB 제약을 함께 확인한다.
2. 문서가 오래된 것인지 코드가 계약을 위반한 것인지 판단한다.
3. 버그 수정이면 기존 제품 의도와 불변식을 유지하고, 계약 변경이면 코드·테스트·문서를 한 작업에서 함께 갱신한다.
4. 무엇을 기준으로 정리했는지 커밋 또는 PR 설명에 남긴다.

## 검증 명령

```bash
npm run lint --prefix server
npm run test:unit --prefix server
npm test --prefix server
npm run lint --prefix customer
npm test --prefix customer
npm run lint --prefix owner
npm test --prefix owner
npm run build --prefix customer
npm run build --prefix owner
```

DB가 필요한 통합 테스트와 환경변수는 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#테스트빌드)를 따른다.

## 저장소 불변식

상세 금지 규칙은 [docs/AI_CHANGE_GUARDRAILS.md](docs/AI_CHANGE_GUARDRAILS.md)가 기준이며, 아래는 어떤 작업에서도 깨지 않는 요약이다.

- 공유 DB에서 로컬 `migrate`를 실행하지 않는다.
- 상태값·플랫폼·한도·시간 정책은 각 constants를 사용한다.
- `recommendations.id`는 UUID다. 순서 집계에 `MIN/MAX(id)`를 사용하지 않는다.
- 날짜·통계 경계는 KST 유틸을 사용한다.
- 사장님 추천곡 라우터는 public 라우터보다 먼저 마운트한다.
- 추천곡 mutation은 `(cafeId, recommendationId)` 범위를 함께 검증한다.
- 클라이언트 IP는 `req.ip`를 사용하고, 익명 쓰기 엔드포인트는 visitor와 IP 제한을 검토한다.
- 사용자 URL fetch는 `safeAxiosGet`을 거친다.
- LLM 음악 필터는 fail-closed다.
- CSP를 끄지 않으며 외부 리소스는 기능별 allowlist로만 추가한다.
- Socket.IO에서 origin 없는 연결이나 `null` origin을 포괄 허용하지 않는다.
- slug는 변경 가능하며 변경 시 새 JWT를 클라이언트가 교체한다.
- `server/app.js`와 `server/server.js` 분리를 유지한다.
- 한국어 커밋·주석, 영어 식별자를 기본으로 한다.
- 화면 확인이 불가능할 때 UI 스타일을 대량 변경하지 않는다.

## 커밋 전 체크리스트

- [ ] 작업에 해당하는 문서와 실제 코드·상수를 읽었다.
- [ ] 변경 범위에 맞는 테스트가 통과했고, customer/owner 변경은 각 테스트와 Vite 빌드가 통과했다.
- [ ] 마이그레이션은 실제 PostgreSQL 스키마와 기존 데이터를 고려했다.
- [ ] 라우트 변경을 [docs/API.md](docs/API.md)에 반영했다.
- [ ] 외부 동작·계약 변경만 문서에 반영했고, 현재 동작과 미래 계획을 섞지 않았다.
- [ ] 시크릿·토큰·개인정보가 포함되지 않았다.
- [ ] 커밋 메시지가 [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md)를 따른다.
