# AGENTS.md

사람과 AI 도구가 Caffeine Flow를 수정할 때 따르는 공통 작업 계약이다. 도구별 파일인 `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`는 이 문서를 가리키는 어댑터다.

## 문서 읽기 원칙

모든 문서를 한꺼번에 읽지 않는다.

1. 먼저 이 문서와 실제 수정 대상 코드·상수·테스트를 읽는다.
2. 아래 라우팅 표에서 작업에 해당하는 문서만 추가로 읽는다.
3. 여러 영역을 가로지르는 변경이면 해당 문서를 모두 읽는다.
4. 외부 동작이나 계약이 바뀌면 담당 문서를 함께 갱신한다.
5. 단순 내부 리팩터링이고 동작이 같다면 문서를 억지로 수정하지 않는다.

문서 전체 지도는 [docs/README.md](docs/README.md)에 있다.

## 작업별 문서 라우팅

| 작업 내용 | 반드시 읽을 문서 |
| --- | --- |
| 시스템 경계, 앱 책임, 데이터 흐름, 상태 모델 변경 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Electron, BrowserView, 재생·종료 감지, 플랫폼 우회 변경 | [docs/PLAYBACK.md](docs/PLAYBACK.md) |
| HTTP 라우트, 요청·응답, 인증, 상태 코드 변경 | [docs/API.md](docs/API.md) |
| 환경변수, 실행 명령, 테스트, 마이그레이션, 배포 변경 | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| 음악 필터, 프롬프트, 모델 호출, 판단·오류 정책 변경 | [docs/LLM_FILTER.md](docs/LLM_FILTER.md) |
| 상태값, 라우터 순서, 플랫폼, 한도, KST, SQL raw, LLM 안전, 마이그레이션 변경 | [docs/AI_CHANGE_GUARDRAILS.md](docs/AI_CHANGE_GUARDRAILS.md) |
| 미구현 기능 검토·설계·우선순위 논의 | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Markdown 문서 추가·이동·분리·대규모 재구성 | [docs/DOCUMENTATION_POLICY.md](docs/DOCUMENTATION_POLICY.md) |
| 커밋 작성 | [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md) |

### 자주 겹치는 작업

- 추천곡 상태 전이 변경: `ARCHITECTURE.md` + `AI_CHANGE_GUARDRAILS.md`
- AI 자동수락 변경: `LLM_FILTER.md` + `AI_CHANGE_GUARDRAILS.md`
- Electron 재생 상태와 서버 큐 연동 변경: `PLAYBACK.md` + `ARCHITECTURE.md` + `AI_CHANGE_GUARDRAILS.md`
- 새 API와 환경변수 추가: `API.md` + `DEVELOPMENT.md`
- 아직 구현하지 않을 아이디어 정리: `ROADMAP.md`만 사용

## 문서 갱신 기준

- 내부 함수 분리, 파일 이동, 이름 정리처럼 외부 동작과 계약이 같으면 문서를 수정하지 않는다.
- 시스템 경계·책임·상태 전이가 바뀌면 `ARCHITECTURE.md`를 수정한다.
- 재생 모드·플랫폼 처리·종료 감지·IPC 계약이 바뀌면 `PLAYBACK.md`를 수정한다.
- API 경로·인증·요청·응답·오류 코드가 바뀌면 `API.md`를 수정한다.
- 환경변수·실행·테스트·마이그레이션·배포 절차가 바뀌면 `DEVELOPMENT.md`를 수정한다.
- LLM 입력·출력·판단 상태·fail-closed 동작이 바뀌면 `LLM_FILTER.md`와 관련 가드레일을 수정한다.
- 아직 구현되지 않은 제안은 현재 동작 문서가 아니라 `ROADMAP.md`에 기록한다.
- 한 사실은 담당 문서 한 곳에서만 자세히 설명하고 다른 문서는 링크만 둔다.

## 코드와 문서가 다를 때

한쪽을 추측해서 따르지 않는다.

1. 실제 코드, 상수, 테스트, DB 제약을 함께 확인한다.
2. 문서가 오래된 것인지 코드가 계약을 위반한 것인지 구분한다.
3. 버그 수정이면 기존 제품 의도와 불변식을 유지한다.
4. 계약 변경이면 코드·테스트·담당 문서를 한 작업에서 함께 갱신한다.
5. 불일치를 발견했으면 커밋 또는 PR 설명에 무엇을 기준으로 정리했는지 남긴다.

## 작업 흐름

1. **분류** — 작업이 어떤 영역과 계약을 건드리는지 판단한다.
2. **읽기** — 대상 코드와 라우팅된 문서·상수·테스트를 확인한다.
3. **경계 확인** — 상태, 라우터 순서, KST, SQL raw, LLM, 마이그레이션은 가드레일을 확인한다.
4. **구현** — 논리 단위를 작게 유지하고 동작 변경과 구조 변경을 가능하면 분리한다.
5. **검증** — 문법, 테스트, 빌드, 문서 동기화를 확인한다.
6. **문서 판단** — 외부 동작이나 계약이 바뀌었을 때만 담당 문서를 갱신한다.
7. **커밋** — `type(scope): 제목` 형식과 Why/Decision을 사용한다.
8. **병합** — 커밋 규칙을 위반한 외부 브랜치는 일반 merge 대신 squash를 사용한다.

## 검증 명령

```bash
npm run test:unit --prefix server
npm test --prefix server
npm run build --prefix customer
npm run build --prefix owner
```

DB가 필요한 통합 테스트와 환경변수는 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#테스트빌드)를 따른다.

## 저장소 불변식

- 공유 DB에서 로컬 `migrate`를 실행하지 않는다.
- `recommendations.id`는 UUID다. 순서 집계에 `MIN/MAX(id)`를 사용하지 않는다.
- 클라이언트 IP는 `req.ip`를 사용한다.
- 사용자 URL fetch는 `safeAxiosGet`을 거친다.
- 익명 쓰기 엔드포인트는 visitor와 IP 제한을 검토한다.
- 사장님 추천곡 라우터는 public 라우터보다 먼저 마운트한다.
- slug는 변경 가능하며 변경 시 새 JWT를 클라이언트가 교체한다.
- 상태값·플랫폼·한도·시간 정책은 각 constants를 사용한다.
- LLM 음악 필터는 fail-closed다.
- `server/app.js`와 `server/server.js` 분리를 유지한다.
- 날짜·통계 경계는 KST 유틸을 사용한다.
- 한국어 커밋·주석, 영어 식별자를 기본으로 한다.
- 화면 확인이 불가능할 때 UI 스타일을 대량 변경하지 않는다.

상세 금지 규칙은 이 문서에 복사하지 않고 [docs/AI_CHANGE_GUARDRAILS.md](docs/AI_CHANGE_GUARDRAILS.md)를 기준으로 한다.

## 커밋 전 체크리스트

- [ ] 작업 종류에 맞는 문서를 선택해 읽었다.
- [ ] 실제 코드와 상수 파일을 확인했다.
- [ ] 변경 범위에 맞는 테스트가 통과했다.
- [ ] customer/owner 변경은 해당 Vite 빌드가 통과했다.
- [ ] 마이그레이션은 실제 PostgreSQL 스키마와 기존 데이터를 고려했다.
- [ ] 라우트 변경은 `docs/API.md`에 반영했다.
- [ ] 외부 동작·계약 변경에 맞춰 담당 문서를 갱신했다.
- [ ] 내부 리팩터링만으로 불필요한 문서 변경을 만들지 않았다.
- [ ] 현재 동작과 미래 계획을 같은 문서에 섞지 않았다.
- [ ] 시크릿·토큰·개인정보가 포함되지 않았다.
- [ ] 커밋 메시지가 [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md)를 따른다.
