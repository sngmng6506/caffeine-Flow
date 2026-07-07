# 개발 가이드

로컬 개발 환경 설정, 환경변수, 마이그레이션, 테스트, 배포.

---

## 환경변수

루트 `.env` 파일 (config.js가 `../../.env`로 로드). 서버·customer 공용.

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

## 설치 & 실행

```bash
npm install
npm install --prefix server
npm install --prefix customer
npm install --prefix owner

npm run migrate --prefix server   # DB 스키마

npm run dev:server     # localhost:3001
npm run dev:customer   # localhost:5173
npm run dev:owner      # localhost:5174

cd owner && npm run electron:dev   # 데스크톱 개발 모드
```

---

## 마이그레이션 (Knex)

`server/src/db/migrations/` 아래 번호순 파일. `knex_migrations` 테이블이 적용 상태를 추적한다.

```bash
npm run migrate --prefix server            # 최신까지 적용
npm run migrate:rollback --prefix server   # 마지막 배치 롤백
```

**주의**
- 공유 DB(Railway 등)에는 로컬에서 `migrate`를 돌리지 말 것 — 배포 시 startCommand가 자동 실행한다.
- `recommendations.id`는 UUID다. 집계 시 `MIN(id)`는 실패하므로 `ROW_NUMBER() OVER (... ORDER BY)`를 쓴다 (018 참고).
- 새 마이그레이션은 up/down을 모두 구현하고, 파괴적 작업 전 기존 데이터 정리 로직을 포함한다.

---

## 테스트

```bash
npm test --prefix server        # 단위 + 통합
npm run test:unit --prefix server   # 단위만 (DB 불필요)
```

- **단위** (`tests/*.test.mjs`) — 검증 헬퍼·KST·상태 전이 등 순수 로직. DB 불필요.
- **통합** (`tests/integration.test.mjs`) — 실제 Postgres에 마이그레이션 적용 후 supertest로 라우트 검증. 아래 환경변수 필요:
  ```bash
  NODE_ENV=test \
  DATABASE_URL=postgres://postgres:test@localhost:5432/caffeine_test \
  JWT_SECRET=any \
  npm test --prefix server
  ```
- `NODE_ENV=test`면 rate limiter가 스킵된다 (같은 IP 연속 요청 때문).

CI(`.github/workflows/ci.yml`)는 push·PR마다 postgres:16 서비스 컨테이너를 띄워 전 파일 구문 검사 + 테스트를 돌린다.

---

## 배포

### 서버 (Railway)
`railway.json`대로 git push 시 자동 빌드:
```
build: customer 빌드 → owner 빌드(VITE env inject) → server 설치
start: npm run migrate --prefix server && node server/server.js
```

빌드 산출물:
- `server/public/` — 손님 SPA (gitignored, 매 배포 빌드)
- `server/public/owner/` — 사장님 SPA (**committed**, Railway fallback). owner 소스 수정 시 로컬 빌드 → commit·push 해야 반영

### 사장님 데스크톱 (GitHub Releases)
로컬에서 직접 (코드 서명·바이너리 업로드가 로컬 환경 의존):
```bash
cd owner
GH_TOKEN=<github_pat> npm run electron:build -- --publish always
```
흐름: Vite → electron-rebuild → packaging → CastLabs EVS 서명 → NSIS 인스톨러 → signtool 서명 → blockmap → GitHub Release + `latest.yml`. 매 빌드 5~15분.

업데이트: 클라이언트가 `latest.yml`을 polling → 새 인스톨러 다운로드 → 재시작 시 `autoUpdater.quitAndInstall`.

버전 범프: `owner/package.json`의 `version`을 올리고 커밋 → 빌드.

---

## 트러블슈팅

| 증상 | 원인·해결 |
| --- | --- |
| 부팅 즉시 throw (JWT_SECRET/DATABASE_URL) | `.env` 누락. config.js가 의도적으로 fail-fast |
| `tenant/user ... not found` | Supabase 등 외부 DB pause·URL 무효. 대시보드에서 확인 |
| `function min(uuid) does not exist` | 마이그레이션이 uuid PK에 MIN/MAX 사용. ROW_NUMBER로 대체 |
| 마이그레이션 락 대기 | 구 인스턴스가 트래픽 유지 중. 배포 완료 후 재시도 |
| 통합 테스트 rate limit 실패 | `NODE_ENV=test` 누락 |
