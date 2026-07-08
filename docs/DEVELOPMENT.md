# 개발 가이드

환경변수, 마이그레이션, 테스트, 배포를 다룬다. 설치·실행 명령은 [README](../README.md#빠른-시작)의 빠른 시작에 있다.

---

## 환경변수

루트에 `.env` 파일을 둔다(config.js가 `../../.env` 경로로 읽는다). 서버와 customer가 함께 쓴다.

| 키 | 필수 | 설명 |
| --- | :-: | --- |
| `DATABASE_URL` | ✓ | Postgres 연결 문자열. **누락 시 즉시 throw** |
| `JWT_SECRET` | ✓ | 32바이트+ 랜덤. **누락·`change-me-in-production`이면 즉시 throw** |
| `DATABASE_SSL` | | `no-verify`(기본)·`verify`·`disable`. Railway 내부망은 `disable` |
| `PORT` | | 기본 3001 (Railway는 자체 주입) |
| `GOOGLE_CLIENT_ID` | OAuth 시 | Google Cloud Console 발급 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | OAuth 시 | Naver Developers |
| `APP_URL` | | OAuth redirect·socket CORS allowlist (기본 `http://localhost:5174`) |
| `SERVER_URL` | | Naver callback URI |
| `YOUTUBE_API_KEY` | | 길이·라이브 체크. 미설정 시 해당 기능 비활성 |

owner SPA 빌드용 (Vite `VITE_*`): `VITE_GOOGLE_CLIENT_ID`, `VITE_NAVER_ENABLED`.

JWT_SECRET 생성:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 마이그레이션 (Knex)

`server/src/db/migrations/` 아래 번호순 파일. `knex_migrations` 테이블이 적용 상태를 추적한다.

```bash
npm run migrate --prefix server            # 최신까지 적용
npm run migrate:rollback --prefix server   # 마지막 배치 롤백
```

마이그레이션 작성 규칙(공유 DB 금지, UUID 집계, up/down, 데이터 보존)은 [../AGENTS.md](../AGENTS.md)의 불변식을 따른다.

---

## 테스트

```bash
npm test --prefix server        # 단위 + 통합
npm run test:unit --prefix server   # 단위만 (DB 불필요)
```

- **단위** (`tests/*.test.mjs`) — 검증 헬퍼, KST, 상태 전이처럼 DB가 필요 없는 순수 로직을 다룬다.
- **통합** (`tests/integration.test.mjs`) — 실제 Postgres에 마이그레이션을 적용한 뒤 supertest로 라우트를 검증한다. 아래 환경변수가 필요하다:
  ```bash
  NODE_ENV=test \
  DATABASE_URL=postgres://postgres:test@localhost:5432/caffeine_test \
  JWT_SECRET=any \
  npm test --prefix server
  ```
- `NODE_ENV=test`이면 rate limiter를 건너뛴다. 테스트가 같은 IP에서 연속으로 요청을 보내기 때문이다.

CI(`.github/workflows/ci.yml`)는 push와 PR마다 postgres:16 서비스 컨테이너를 띄워 전체 파일 구문 검사와 테스트를 실행한다.

---

## 배포

### 서버 (Railway)
`railway.json` 설정에 따라 git push하면 자동으로 빌드된다:
```
build: customer 빌드 → owner 빌드(VITE env inject) → server 설치
start: npm run migrate --prefix server && node server/server.js
```

빌드 산출물:
- `server/public/` — 손님 SPA. gitignore 대상이며 배포할 때마다 새로 빌드된다.
- `server/public/owner/` — 사장님 SPA. 저장소에 **커밋**되며 Railway 빌드 실패 시 fallback으로 쓰인다. owner 소스를 고치면 로컬에서 빌드한 뒤 commit·push해야 반영된다.

### 사장님 데스크톱 (GitHub Releases)
코드 서명과 바이너리 업로드가 로컬 환경에 의존하므로, 로컬에서 직접 실행한다:
```bash
cd owner
GH_TOKEN=<github_pat> npm run electron:build -- --publish always
```
빌드 흐름은 Vite → electron-rebuild → packaging → CastLabs EVS 서명 → NSIS 인스톨러 → signtool 서명 → blockmap → GitHub Release + `latest.yml` 순이다. 한 번에 5~15분 걸린다.

업데이트는 클라이언트가 `latest.yml`을 polling하다가 새 인스톨러를 내려받고, 재시작할 때 `autoUpdater.quitAndInstall`로 적용하는 방식이다.

버전을 올릴 때는 `owner/package.json`의 `version`을 수정해 커밋한 뒤 빌드한다.
