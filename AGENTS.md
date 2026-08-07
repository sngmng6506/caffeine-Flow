# AGENTS.md

사람과 AI 도구가 Caffeine Flow를 수정할 때 따르는 공통 작업 계약이다. 도구별 파일인 `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`는 이 문서를 가리키는 어댑터다.

## 먼저 읽을 문서

| 작업 | 문서 |
| --- | --- |
| 전체 구조 파악 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Electron 재생 변경 | [docs/PLAYBACK.md](docs/PLAYBACK.md) |
| API 변경 | [docs/API.md](docs/API.md) |
| AI 음악 필터 변경 | [docs/LLM_FILTER.md](docs/LLM_FILTER.md) |
| 실행·환경변수·배포 | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| 상태·라우터·KST·SQL·LLM 변경 | [docs/AI_CHANGE_GUARDRAILS.md](docs/AI_CHANGE_GUARDRAILS.md) |
| 커밋 작성 | [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md) |

문서 전체 지도는 [docs/README.md](docs/README.md)에 있다.

## 작업 흐름

1. **읽기** — 변경 대상 코드와 관련 상수·테스트를 먼저 확인한다.
2. **경계 확인** — 상태, 라우터 순서, KST, SQL raw, LLM, 마이그레이션은 가드레일을 확인한다.
3. **구현** — 논리 단위를 작게 유지하고 동작 변경과 구조 변경을 가능하면 분리한다.
4. **검증** — 문법, 테스트, 빌드, 문서 동기화를 확인한다.
5. **커밋** — `type(scope): 제목` 형식과 Why/Decision을 사용한다.
6. **병합** — 커밋 규칙을 위반한 외부 브랜치는 일반 merge 대신 squash를 사용한다.

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

- [ ] 실제 코드와 상수 파일을 확인했다.
- [ ] 변경 범위에 맞는 테스트가 통과했다.
- [ ] customer/owner 변경은 해당 Vite 빌드가 통과했다.
- [ ] 마이그레이션은 실제 PostgreSQL 스키마와 기존 데이터를 고려했다.
- [ ] 라우트 변경은 `docs/API.md`에 반영했다.
- [ ] 현재 동작과 미래 계획을 같은 문서에 섞지 않았다.
- [ ] 시크릿·토큰·개인정보가 포함되지 않았다.
- [ ] 커밋 메시지가 [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md)를 따른다.
