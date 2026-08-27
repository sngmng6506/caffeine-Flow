# 개발 가이드

> **AI가 읽을 때:** 환경변수, 설치·실행 명령, 테스트, 마이그레이션, Railway·Electron 배포를 수정할 때
> **함께 갱신할 때:** 개발자가 실제로 따라야 하는 명령·설정·검증·릴리스 절차가 달라질 때
> **생략 가능한 경우:** 기존 실행 방법을 유지한 채 애플리케이션 로직만 수정할 때

로컬 실행, 환경변수, 테스트, 마이그레이션, 배포 절차를 다룬다. 시스템 구조는 [ARCHITECTURE.md](ARCHITECTURE.md), Electron 재생은 [PLAYBACK.md](PLAYBACK.md)를 참고한다.

## 설치와 실행

요구사항은 Node.js 20.19+ 또는 22.12+, PostgreSQL 16 권장, npm이다.

```bash
npm ci --prefix server
npm ci --prefix customer
npm ci --prefix owner

npm run migrate --prefix server
npm run dev:server     # 3000
npm run dev:customer   # 5173
npm run dev:owner      # 5174

npm run electron:dev --prefix owner
```

각 dev 명령은 별도 터미널에서 실행한다.

## 환경변수

루트 `.env`를 서버가 읽고 배포에서는 Railway 환경변수를 사용한다. 전체 예시는 [.env.example](../.env.example), 기본값은 `server/src/config.js`가 기준이다.

| 키 | 설명 |
| --- | --- |
| `DATABASE_URL` | **필수.** PostgreSQL 연결 문자열 |
| `JWT_SECRET` | **필수.** 32바이트 이상 랜덤 문자열. 누락·기본값이면 서버가 시작하지 않는다 |
| `PORT` | 서버 포트, 기본 3000 |
| `APP_URL` | OAuth 이동·Socket.IO CORS 기준 URL |
| `SERVER_URL` | Naver callback 기준 서버 URL |
| `DATABASE_SSL` | `disable`, `no-verify`, `verify` |
| `ADMIN_PASSWORD` | 운영자 콘솔 비밀번호. 없으면 `/admin/login`이 503 |
| `GOOGLE_CLIENT_ID` | Google 로그인 |
| `NAVER_CLIENT_ID` | Naver 로그인 |
| `NAVER_CLIENT_SECRET` | Naver 로그인 |
| `ALERT_WEBHOOK_URL` | 운영자 에러 알림 Discord webhook. 미설정이면 알림 없이 로그만 남는다 |
| `OPENROUTER_API_KEY` | OpenRouter 인증. 필터 ON에서 누락 시 fail-closed |
| `OPENROUTER_BASE_URL` | 기본 `https://openrouter.ai/api/v1` |
| `OPENROUTER_APP_NAME` | 기본 `Caffeine Flow` |
| `MUSIC_FILTER_MODEL` | 기본 `anthropic/claude-sonnet-5` |
| `MUSIC_FILTER_TIMEOUT_MS` | 기본 `8000` |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

owner Vite 빌드는 `VITE_GOOGLE_CLIENT_ID`, `VITE_NAVER_ENABLED`를 사용한다.

구조화 출력을 tool(function) call로 받으므로 모델은 tool calling을 지원해야 한다. 동작 계약은 [LLM_FILTER.md](LLM_FILTER.md)를 따른다.

## 마이그레이션

```bash
npm run migrate --prefix server
npm run migrate:rollback --prefix server
```

> 공유·운영 DB에 로컬에서 `migrate`를 실행하지 않는다. 배포 start command가 적용한다.

`up`·`down` 구현, 기존 데이터 보존 우선, UUID를 정수 PK처럼 다루지 않기, partial unique index 전 충돌 데이터 정리, 실제 PostgreSQL 스키마 검증이 기본이다. 상세 계약은 [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md#migration-contract)에 있다.

## 테스트·빌드

```bash
npm run test:unit --prefix server    # DB 비의존 테스트만
npm test --prefix server             # 마이그레이션 포함 통합 테스트
npm run build --prefix customer
npm run build --prefix owner
```

`test:unit`은 `vitest.unit.config.mjs`에 명시된 테스트만 실행하며 PostgreSQL에 연결하지 않는다.

```bash
NODE_ENV=test \
DATABASE_URL=postgres://postgres:test@localhost:5432/caffeine_test \
JWT_SECRET=ci-only-secret \
npm test --prefix server
```

CI는 `server-test`(PostgreSQL + 문법 + 단위·통합 테스트)와 `frontend-build`(customer·owner Vite 빌드, Electron 메인 문법 검사)를 실행한다.

## 서버 배포

`main` push 시 Railway가 `railway.json`에 따라 배포한다.

```text
customer build → owner build → server install
→ pre-deploy migration → server/server.js 실행
```

- customer를 먼저 빌드한다. customer 빌드가 `server/public`을 비우므로 순서를 바꾸지 않는다.
- 배포 전 마이그레이션은 `preDeployCommand`에서 실행하고 `/health`가 성공해야 정상 배포로 판정한다.
- Railway 서비스 설정에서 **Wait for CI**를 켠다. `railway.json`이 아니라 GitHub autodeploy 설정이며, 켜져 있으면 Actions가 실패한 커밋은 배포가 `SKIPPED`된다. [Railway 문서](https://docs.railway.com/deployments/github-autodeploys#wait-for-ci)를 따른다.

정적 파일 경로:

```text
customer     → server/public
owner        → server/public/owner
admin        → 루트 admin 디렉터리를 /admin에서 제공
filter lab   → 루트 music-filter-lab을 /filter-lab에서 제공
labeling lab → 루트 music-labeling-lab을 /labeling-lab에서 제공
```

## 에러 알림

서버 에러는 `server/src/observability/`를 거쳐 한 형식으로 로깅되고, 일부만 Discord로 나간다.

```text
[error] code=LLM_TIMEOUT cause=external cafe=<uuid> slug=<slug> route=POST /... msg=...
```

알림 여부는 `error-taxonomy.js`가 정하며 호출부는 관여하지 않는다. 기준은 심각도가 아니라 **원인 주체**다.

| `cause` | 의미 | 처리 |
| --- | --- | --- |
| `user` | 손님·사장님 입력 탓 | 로그만. 정상 운영 중에도 계속 발생한다 |
| `external` | 외부 플랫폼·LLM 탓 | 5분 창에 5건이면 알림 |
| `platform` | 우리 코드·설정 탓 | 5분 창에 임계값(전역 500은 10건)이면 알림 |

`LLM_API_KEY_MISSING`, `LLM_HTTP_401/402/403`, `DB_CONNECTION_FAILED`, `UNCAUGHT_EXCEPTION`, `UNHANDLED_REJECTION`은 1건도 즉시 알린다. 이미 서비스가 멈춰 있다는 뜻이기 때문이다.

집계는 카페가 아니라 에러 코드 단위로 하고 영향받은 카페 수를 함께 센다. 한 카페에서만 반복되면 그 매장 설정 문제, 여러 카페에서 동시에 나면 플랫폼 전체 사고로 읽는다. 같은 코드는 1시간에 한 번까지만 재전송한다.

임계값·창·쿨다운을 바꾸려면 `server/src/observability/error-taxonomy.js`를 수정하고 `server/tests/alert-aggregator.test.mjs`를 함께 확인한다.

## Electron 배포

버전은 `owner/package.json`에서 관리한다.

```bash
npm run electron:build --prefix owner -- --publish never
```

로컬 명령은 설치 파일과 업데이트 메타데이터만 만든다. 공식 배포는 `owner/package.json` 버전과 같은 `v*` 태그를 push하면 `.github/workflows/release.yml`이 수행한다.

수동 복구는 Actions의 `Release Desktop App`에서 이미 존재하는 태그를 입력해 실행한다. 수동 실행도 해당 태그를 checkout하고 태그와 버전 일치, checkout 커밋과 태그 커밋 일치, 서버 테스트와 두 빌드 성공, EVS 서명 성공을 검증하므로 `main`의 최신 커밋을 같은 버전에 재발행하지 않는다.

워크플로는 `electron-builder --publish never`로 빌드한 뒤 GitHub CLI로 Release를 생성·재사용하고 자산을 `--clobber` 업로드한다. 실패한 동일 버전을 재실행해도 경합이나 자산 충돌 없이 복구할 수 있으며, 새 Release는 자산 업로드가 끝날 때까지 draft로 유지한다.

정상 Release에는 `<installer>.exe`, `<installer>.exe.blockmap`, `latest.yml`이 모두 있어야 한다. 실행 중인 앱은 `latest.yml`과 blockmap으로 업데이트를 확인한다. 메인 프로세스가 확인·발견·다운로드·오류 상태를 보관하고 renderer가 시작될 때 `get-update-status`로 다시 조회하므로 구독 전에 다운로드가 끝나도 설치 알림이 유실되지 않는다.

릴리스 전 확인:

- owner Vite 빌드 성공
- 로그인과 기본 BGM 재생
- 세 플랫폼 신청곡 재생·종료
- overlay와 Spotify takeover 복귀
- 새 버전 다운로드·재시작

DRM·서명·플랫폼 제약은 [PLAYBACK.md](PLAYBACK.md)를 참고한다.

## 자주 확인할 파일

```text
.env.example
railway.json
.github/workflows/ci.yml
server/src/db/migrations/
owner/package.json
```
