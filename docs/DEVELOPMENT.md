# 개발 가이드

> **AI가 읽을 때:** 환경변수, 설치·실행 명령, 테스트, 마이그레이션, Railway·Electron 배포를 수정할 때
> **함께 갱신할 때:** 개발자가 실제로 따라야 하는 명령·설정·검증·릴리스 절차가 달라질 때
> **생략 가능한 경우:** 기존 실행 방법을 유지한 채 애플리케이션 로직만 수정할 때

로컬 실행, 환경변수, 테스트, 마이그레이션, 배포 절차를 다룬다. 시스템 구조는 [ARCHITECTURE.md](ARCHITECTURE.md), Electron 재생은 [PLAYBACK.md](PLAYBACK.md)를 참고한다.

## 요구사항

```text
Node.js 20+
PostgreSQL 16 권장
npm
```

## 설치와 실행

```bash
npm install
npm install --prefix server
npm install --prefix customer
npm install --prefix owner

npm run migrate --prefix server
npm run dev:server
npm run dev:customer
npm run dev:owner
```

각 명령은 별도 터미널에서 실행한다.

Electron 개발 모드:

```bash
npm run electron:dev --prefix owner
```

기본 포트:

```text
server    3001
customer  5173
owner     5174
```

## 환경변수

루트 `.env`를 서버가 읽는다. 배포에서는 Railway 환경변수를 사용한다.

### 필수

| 키 | 설명 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `JWT_SECRET` | 32바이트 이상의 랜덤 문자열 |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 서비스 설정

| 키 | 설명 |
| --- | --- |
| `PORT` | 서버 포트, 기본 3001 |
| `APP_URL` | OAuth 이동·Socket.IO CORS 기준 URL |
| `SERVER_URL` | Naver callback 기준 서버 URL |
| `DATABASE_SSL` | `disable`, `no-verify`, `verify` |
| `ADMIN_PASSWORD` | 운영자 콘솔 비밀번호 |

### 인증과 음악 메타데이터

| 키 | 설명 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google 로그인 |
| `NAVER_CLIENT_ID` | Naver 로그인 |
| `NAVER_CLIENT_SECRET` | Naver 로그인 |
| `YOUTUBE_API_KEY` | YouTube 길이·라이브 확인 |

owner Vite 빌드:

```text
VITE_GOOGLE_CLIENT_ID
VITE_NAVER_ENABLED
```

### AI 음악 필터

| 키 | 기본값·설명 |
| --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter 인증. 필터 ON에서 누락 시 fail-closed |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |
| `OPENROUTER_APP_NAME` | `Caffeine Flow` |
| `MUSIC_FILTER_MODEL` | `openai/gpt-4.1-mini` |
| `MUSIC_FILTER_TIMEOUT_MS` | `8000` |

모델은 JSON Schema structured output을 지원해야 한다. 동작 계약은 [LLM_FILTER.md](LLM_FILTER.md)를 따른다.

전체 예시는 루트 [.env.example](../.env.example)이 기준이다.

## 마이그레이션

```bash
npm run migrate --prefix server
npm run migrate:rollback --prefix server
```

> 공유·운영 DB에 로컬에서 `migrate`를 실행하지 않는다. 배포 start command가 적용한다.

작성 규칙:

- `up`과 `down` 구현
- 기존 데이터 보존 우선
- UUID를 정수 PK처럼 처리하지 않음
- partial unique index 전에 기존 충돌 데이터 정리
- 실제 PostgreSQL 스키마로 검증

상세 계약은 [AI_CHANGE_GUARDRAILS.md#migration-contract](AI_CHANGE_GUARDRAILS.md#migration-contract)를 참고한다.

## 테스트·빌드

서버:

```bash
npm run test:unit --prefix server
npm test --prefix server
```

`test:unit`은 `vitest.unit.config.mjs`에 명시된 DB 비의존 테스트만 실행하며
마이그레이션이나 PostgreSQL 연결을 수행하지 않는다. `npm test`는 실제
PostgreSQL에 마이그레이션을 적용하는 통합 테스트를 포함한다.

통합 테스트 환경 예시:

```bash
NODE_ENV=test \
DATABASE_URL=postgres://postgres:test@localhost:5432/caffeine_test \
JWT_SECRET=ci-only-secret \
npm test --prefix server
```

프론트:

```bash
npm run build --prefix customer
npm run build --prefix owner
```

CI는 다음을 실행한다.

```text
commit-message  커밋 규칙 검사
server-test     PostgreSQL + 문법 + 단위·통합 테스트
frontend-build  customer·owner Vite 빌드
```

## 서버 배포

`main` push 시 Railway가 `railway.json`에 따라 배포한다.

```text
customer build
→ owner build
→ server install
→ migration
→ server/server.js 실행
```

정적 파일:

```text
customer → server/public
owner    → server/public/owner
```

customer를 먼저 빌드한 뒤 owner를 빌드한다. customer 빌드가 `server/public`을 비우므로 순서를 바꾸지 않는다.

## Electron 배포

버전은 `owner/package.json`에서 관리한다.

```bash
cd owner
GH_TOKEN=<github_pat> npm run electron:build -- --publish always
```

결과물은 GitHub Release에 게시되고 실행 중인 앱이 업데이트를 확인한다. DRM·서명·플랫폼 제약은 [PLAYBACK.md](PLAYBACK.md)를 참고한다.

릴리스 전 확인:

- owner Vite 빌드 성공
- 로그인과 기본 BGM 재생
- 세 플랫폼 신청곡 재생·종료
- overlay와 Spotify takeover 복귀
- 새 버전 다운로드·재시작

## 자주 확인할 파일

```text
.env.example
railway.json
.github/workflows/ci.yml
server/src/db/migrations/
owner/package.json
```
