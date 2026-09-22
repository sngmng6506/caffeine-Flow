# 개발 가이드

> **AI가 읽을 때:** 환경변수, 설치·실행 명령, 테스트, 마이그레이션, Railway·Electron 배포를 수정할 때
> **함께 갱신할 때:** 개발자가 실제로 따라야 하는 명령·설정·검증·릴리스 절차가 달라질 때
> **생략 가능한 경우:** 기존 실행 방법을 유지한 채 애플리케이션 로직만 수정할 때

로컬 실행, 환경변수, 테스트, 마이그레이션, 배포 절차를 다룬다. 시스템 구조는 [ARCHITECTURE.md](ARCHITECTURE.md), Electron 재생은 [PLAYBACK.md](PLAYBACK.md)를 참고한다.

## 설치와 실행

요구사항은 PostgreSQL 16 권장과 npm이며, Node는 앱마다 하한이 다르다.

| 대상 | 최소 Node | 이유 |
| --- | --- | --- |
| `server` | 20.19+ | 운영(Railway) 기준 |
| `customer`, `owner` | 22.13+ | 테스트가 쓰는 jsdom 30의 의존 undici가 `worker_threads.markAsUncloneable`(Node 22.10 추가)을 요구한다. Node 20에서는 테스트 파일을 읽기 전에 worker가 죽는다 |

CI도 같은 이유로 `server-test`는 Node 20, `frontend-build`는 22.13.0으로 나눠 실행한다.

```bash
npm ci                          # 운영자 Lab 린트 도구
npm ci --prefix server
npm ci --prefix customer
npm ci --prefix owner

npm run migrate --prefix server
npm run seed:demo --prefix server   # 화면 확인용 데모 데이터 (선택)
npm run dev:server     # 3000
npm run dev:customer   # 5173
npm run dev:owner      # 5174

npm run electron:dev --prefix owner
```

각 dev 명령은 별도 터미널에서 실행한다.

Claude Code 웹 세션은 매번 새로 클론돼 `node_modules`가 없다. `.claude/hooks/session-start.sh`가
세션 시작 시 루트와 세 앱의 의존성을 설치하고(루트는 `lint:labs`가 쓴다), 컨테이너 안에
통합 테스트용 PostgreSQL과 `caffeine_test` DB를 띄운 뒤 테스트용 루트 `.env`를 만든다 —
아래 검증 명령을 인라인 환경변수 없이 그대로 실행할 수 있다. PostgreSQL이 없는 컨테이너에서는
DB 준비만 건너뛰고 세션을 계속한다. 로컬에서는 전체를 건너뛰며(`CLAUDE_CODE_REMOTE`로 판단),
lockfile이 바뀐 브랜치를 받았을 때는 위 `npm ci`를 다시 실행한다.

### 기동 로그로 설정 확인

서버는 시작할 때 실제로 적용된 설정을 한 줄 남긴다. 배포 로그에서 이것만 보면
알림과 CORS 상태를 판정할 수 있다.

```text
  NODE_ENV=production · 에러 알림 켜짐 · 허용 origin 1개
```

`NODE_ENV`가 없거나 알림이 꺼져 있으면 경고가 함께 나온다(로컬 `development`·`test`
제외 — nodemon 재시작마다 반복되면 소음이다). 시크릿은 찍지 않는다.

전송까지 확인하려면 운영자 콘솔 토큰으로 `POST /api/v1/admin/alert-test`를 호출한다.
실제 알림 경로(집계 → 채널 → 웹훅)를 그대로 타므로 웹훅이 서버에서 실제로
나가는지까지 확인된다. 전용 코드를 써서 진짜 장애의 30분 쿨다운은 건드리지
않지만, 테스트 알림 자체에는 같은 쿨다운이 적용된다.

### 데모 데이터

`npm run seed:demo --prefix server`는 손님 화면의 시각적 상태를 한 번에 만든다 —
재생 중, 대기 중, 확인 중, 최근 재생, 거절, 썸네일 없는 곡, 긴 제목,
YouTube 아닌 플랫폼, 같은 곡의 추적 파라미터 변형, 전체 TOP 전용 곡(다른 매장).
`/demo`로 접속하며, 다시 실행하면 데모 카페 두 개만 지우고 새로 만든다.

통합 테스트는 자기 데이터를 따로 만들므로 이 스크립트에 의존하지 않는다.
운영 사고를 막기 위해 `NODE_ENV=production`이거나 DB 호스트가 localhost가
아니면 중단하며, 후자는 `SEED_DEMO_ALLOW_REMOTE=true`로만 넘길 수 있다.

이 데이터로 손님·사장님 화면을 실제로 띄우고 조작하는 절차는
[.claude/skills/run-app/SKILL.md](../.claude/skills/run-app/SKILL.md)에 있다.

## 환경변수

루트 `.env`를 서버가 읽고 배포에서는 Railway 환경변수를 사용한다. 전체 예시는 [.env.example](../.env.example), 기본값은 `server/src/config.js`가 기준이다.

이 표는 전체 목록이 아니다. **빠뜨리거나 잘못 두면 조용히 다치는 것**만 적는다.

| 키 | 놓치면 생기는 일 |
| --- | --- |
| `JWT_SECRET` | 누락·기본값이면 서버가 시작하지 않는다. 32바이트 이상 랜덤 |
| `NODE_ENV` | 배포에서 **명시적으로 `production`**. 없으면 운영이 아닌 것으로 취급돼 개발 localhost origin이 허용되고 CORS·쿠키 Secure·rate limit·알림 경고가 함께 어긋난다 |
| `ALERT_WEBHOOK_URL` | **프로세스 시작 시 한 번만 읽는다.** 배포 후 추가했다면 재시작해야 켜진다. production에서 비어 있으면 시작 로그에 경고가 남는다 |
| `AUDIO_ANALYSIS_WORKER_TOKEN` | 결과 제출과 작업 큐를 함께 게이트한다. 없으면 두 경로 모두 503이라 자동 라벨링이 아예 돌지 않는다. 서버와 워커에 같은 값을 넣는다 — Railway 환경변수는 미니PC에 자동 전달되지 않는다 |
| `OPENROUTER_API_KEY` | 필터 ON에서 누락 시 fail-closed. 서버 필터와 워커 3단이 **각자의 실행 환경**에서 읽는다 |
| `MUSIC_FILTER_MODEL` | 구조화 출력을 tool call로 받으므로 tool calling을 지원하는 모델이어야 한다 |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

owner Vite 빌드는 `VITE_GOOGLE_CLIENT_ID`, `VITE_NAVER_ENABLED`를 사용한다.

구조화 출력을 tool(function) call로 받으므로 모델은 tool calling을 지원해야 한다. 동작 계약은 [LLM_FILTER.md](LLM_FILTER.md)를 따른다.

## 오디오 분석 워커

`audio-analysis-worker/`는 서버와 별도로 미니PC에서 도는 Python 프로세스다. 설치·실행·환경변수·테스트·진단은 [워커 README](../audio-analysis-worker/README.md)가 기준이다. 서버와 공유하는 두 변수는 위 [환경변수](#환경변수) 표에 있다.

서버 마이그레이션을 배포한 뒤 호환되는 미니PC 저장소 전체를 갱신한다. 워커 Python 파일만 복사하면 공유 JSON 계약·프롬프트가 어긋날 수 있다.

## 마이그레이션

```bash
npm run migrate --prefix server
npm run migrate:rollback --prefix server
```

> 공유·운영 DB에 로컬에서 `migrate`를 실행하지 않는다. Railway의 `preDeployCommand`가 적용한다.

`up`·`down` 구현, 기존 데이터 보존 우선, UUID를 정수 PK처럼 다루지 않기, partial unique index 전 충돌 데이터 정리, 실제 PostgreSQL 스키마 검증이 기본이다. 상세 계약은 [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md#migration-contract)에 있다.

## 테스트·빌드

```bash
npm run lint:labs                   # 정적 운영자 Lab ESLint (루트 의존성 필요)
npm run lint --prefix server         # ESLint
npm run test:unit --prefix server    # DB 비의존 테스트만
npm test --prefix server             # 마이그레이션 포함 통합 테스트
npm run lint --prefix owner          # 사장님 React·Electron ESLint
npm test --prefix owner              # 사장님 화면 훅 테스트 (jsdom)
npm run lint --prefix customer       # 손님 React ESLint
npm test --prefix customer           # 손님 화면 테스트 (jsdom)
npm run build --prefix customer
npm run build --prefix owner
```

테스트가 고정하는 것은 개별 가드가 아니라 **관찰 가능한 속성**이다. 예컨대 리더 게이트는 `startPlaying` 내부와 각 호출부에 이중으로 걸려 있어 한 쪽만 지워도 테스트는 통과한다 — 고정 대상은 "리더가 아닌 화면은 `playRec`을 호출하지 않는다"이다. 가드가 중복으로 보여도 지우기 전에 이 점을 확인한다.

`customer` 테스트는 손님 신원과 상호작용 판정을 덮는다. visitor ID는 신청 취소 권한의 근거라 모든 요청에 실려야 한다. 색상·레이아웃은 대상이 아니다 — 화면 확인이 불가능한 환경에서 스타일을 검증하면 의미 없는 스냅샷만 쌓인다.

`vi.fn()`은 vitest config의 `restoreMocks` 대상이 아니다. 호출 기록에 의존하는 테스트는 `beforeEach`에서 직접 `mockClear()`한다.

**포맷터는 두지 않는다.** 기존 스타일이 이미 일관되고, 한 번 돌리면 전 파일이 diff로 뒤집혀 리뷰가 불가능해진다. 린트 규칙은 포맷팅이 아니라 "실행해봐야 아는 실수"만 다룬다. 기존 effect 의도를 검토하며 도입할 수 있도록 `react-hooks/exhaustive-deps`만 경고이고 나머지 버그성 규칙은 오류다. `admin`은 아직 린트 대상이 아니다.

`test:unit`은 `vitest.unit.config.mjs`에 명시된 테스트만 실행하며 PostgreSQL에 연결하지 않는다.

```bash
NODE_ENV=test \
DATABASE_URL=postgres://postgres:test@localhost:5432/caffeine_test \
JWT_SECRET=ci-only-secret \
npm test --prefix server
```

CI 구성은 [.github/workflows/ci.yml](../.github/workflows/ci.yml)이 기준이다.

- `server-test`: PostgreSQL 기반 서버 테스트·린트와 운영자 Lab 린트
- `audio-worker-test`: Python 단위 테스트. 실제 모델·음원 다운로드·외부 LLM은 실행하지 않음
- `frontend-build`: customer·owner 린트·테스트와 Vite 빌드. owner 린트는 Electron 메인·preload도 포함

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
| `external` | 외부 플랫폼·LLM 탓 | 알림 |
| `platform` | 우리 코드·설정 탓 | 알림 |

`cause`는 알림 계층이 status로 추측하지 않는다. 같은 status라도 플랫폼마다 뜻이 다르기 때문이다. SoundCloud의 403은 서버 IP 차단(우리가 알아야 할 신호)이지만 YouTube oEmbed의 401은 임베드 비활성화(손님이 고른 곡의 속성)다.

그래서 status 의미를 아는 throw 지점이 에러에 `upstream` 표식을 달고, `trackErrorCause`는 그 표식만 해석한다. 새 조회 경로를 추가할 때는 그 자리에서 "이 실패가 우리 문제인가"를 판단해 표식을 달아야 한다. 표식이 없으면 손님 탓으로 간주해 알리지 않는다.

네이버 콜백도 같은 이유로 `naverCallbackError`가 판단한다. 이 `catch` 하나가 네이버 HTTP 호출과 DB 조회를 함께 감싸므로, 범용 소켓 코드만 보면 네이버 DNS 실패가 `DB_CONNECTION_FAILED`로 둔갑한다.

성공 경로가 남아 있는 중간 실패는 보고하지 않는다. SoundCloud oEmbed가 실패해도 HTML 파싱으로 곡을 찾아내면 그 요청은 정상이므로, 최종 실패 지점 한 곳에서만 보고한다.

현재 설정은 **종류별 첫 발생을 바로 알리고 같은 코드는 30분간 잠잠하게 두는** 방식이다. 소음을 임계값이 아니라 쿨다운으로 막는다.

창과 임계값은 함께 최소 발생률을 정한다. 창이 미끄러지며 오래된 이벤트를 버리므로 그 비율을 못 넘는 에러는 아무리 오래 이어져도 알림이 나가지 않는다. 이 서비스는 신청량이 많지 않아 높은 임계값이 곧 "영영 안 울림"이 된다. 하루 200건 규모에서 5건/5분(분당 1건)은 LLM이 완전히 죽어도 도달하지 못한다.

`LLM_API_KEY_MISSING`, `LLM_HTTP_401/402/403`, `DB_CONNECTION_FAILED`, `UNCAUGHT_EXCEPTION`, `UNHANDLED_REJECTION`은 임계값과 무관하게 즉시 알린다. 알림 문구도 달라지는데, 이들은 1건에 나가므로 카페 수로 원인을 추론하지 않는다.

집계는 카페가 아니라 에러 코드 단위로 하고 영향받은 카페 수를 함께 센다. 한 카페에서만 반복되면 그 매장 설정 문제, 여러 카페에서 동시에 나면 플랫폼 전체 사고로 읽는다.

창·임계값·쿨다운의 실제 값은 `server/src/observability/error-taxonomy.js`가 단일 기준이다.

쿨다운 중에도 집계는 계속되므로 해제 직후 문제가 여전하면 바로 다시 알린다. 채널이 시끄러우면 임계값보다 쿨다운을 먼저 늘리는 편이 효과적이다.

임계값이 1이면 첫 알림은 항상 1건·1카페다. 표본이 없으므로 알림 문구도 범위를 단정하지 않고, 2건 이상 쌓인 뒤부터 매장 문제와 플랫폼 사고를 구분한다.

알려진 한계: 쿨다운은 프로세스 메모리에만 있어 재시작하면 초기화된다. 크래시 루프를 도는 상황에서는 재시작 횟수만큼 알림이 나갈 수 있다. 영속화 대신 이 동작을 받아들인 이유는, 크래시 루프 자체가 즉시 알아야 할 상태이고 Railway 배포 알림과도 겹치기 때문이다.

`uncaughtException`과 `unhandledRejection`은 로그를 남긴 뒤 프로세스를 종료한다. 두 이벤트는 핸들러를 등록하는 것만으로 Node의 기본 크래시 동작이 꺼지므로, 로그만 남기고 살려두면 상태가 깨진 프로세스가 계속 도는 대신 자동 재시작을 잃는다. 종료 유예는 웹훅 전송 타임아웃보다 길게 잡아(`CRASH_EXIT_DELAY_MS`) 마지막 알림이 잘리지 않게 한다.

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
