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
세션 시작 시 세 앱의 의존성을 설치하므로 lint·test를 바로 실행할 수 있다. 로컬에서는
건너뛰며(`CLAUDE_CODE_REMOTE`로 판단), lockfile이 바뀐 브랜치를 받았을 때는 위 `npm ci`를 다시 실행한다.

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
| `AUDIO_ANALYSIS_WORKER_TOKEN` | Essentia 워커 결과 제출 전용 토큰. 없으면 결과 수집 API가 503 |
| `GOOGLE_CLIENT_ID` | Google 로그인 |
| `NAVER_CLIENT_ID` | Naver 로그인 |
| `NAVER_CLIENT_SECRET` | Naver 로그인 |
| `ALERT_WEBHOOK_URL` | 운영자 에러 알림 Discord webhook. 미설정이면 알림 없이 로그만 남는다. **프로세스 시작 시 한 번만 읽으므로 배포 후 추가했다면 재시작해야 켜진다** — production에서 비어 있으면 시작 로그에 경고가 남는다 |
| `NODE_ENV` | `production` / `development` / `test`. 배포에서는 **명시적으로 `production`을 설정한다** — 없으면 운영이 아닌 것으로 취급돼 개발 localhost origin이 허용되고, CORS·쿠키 Secure·rate limit·알림 경고가 함께 어긋난다 |
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

## Essentia 라벨링 워커

`audio-analysis-worker/`는 서버와 별도 Python 프로세스로 실행한다. 기존 로컬 CLI와 서버 작업 큐 기반 자동 워커를 제공한다. 원본 음원은 서버에 전송하지 않는다.

```bash
cd audio-analysis-worker
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python analyze.py ./authorized-track.wav \
  --platform youtube --track-key VIDEO_ID \
  --rights-basis licensed --source-reference license-ticket-001 \
  --server-url http://localhost:3000
```

서버와 워커에 같은 `AUDIO_ANALYSIS_WORKER_TOKEN`을 설정한다. 상세 옵션과 Windows 실행법은 [audio-analysis-worker/README.md](../audio-analysis-worker/README.md)를 따른다.

```bash
python -m unittest discover -s audio-analysis-worker -p 'test_*.py'
```

미니PC 상주 운영은 `remote_worker.py`가 서버 DB 큐를 폴링한다. 다운로드·분석 의존성과 등록 절차는 [워커 README](../audio-analysis-worker/README.md)를 따른다. 기존 `worker.py`는 수동 디렉터리 큐 호환용이다.

Valence/Arousal은 `ENABLE_VALENCE_AROUSAL=true`일 때만 `deam-msd-musicnn` 모델로 채운다. 기본값은 꺼짐이며, 모델이 비상업(CC BY-NC-SA 4.0) 라이선스라 라벨링 Lab 평가에만 쓰고 신청곡 자동 승인에 연결하지 않는다. 상업화에는 별도 라이선스가 필요하다. 모델 파일은 저장소에 커밋하지 않고 `AUDIO_MODEL_DIR`에 두며 워커가 SHA-256을 확인한다.

## 마이그레이션

```bash
npm run migrate --prefix server
npm run migrate:rollback --prefix server
```

> 공유·운영 DB에 로컬에서 `migrate`를 실행하지 않는다. 배포 start command가 적용한다.

`up`·`down` 구현, 기존 데이터 보존 우선, UUID를 정수 PK처럼 다루지 않기, partial unique index 전 충돌 데이터 정리, 실제 PostgreSQL 스키마 검증이 기본이다. 상세 계약은 [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md#migration-contract)에 있다.

## 테스트·빌드

```bash
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

`owner` 테스트는 재생 리더와 자동수락의 **배선**을 검증한다. 순수 판단 로직은
`src/pages/dashboard/*.mjs` 헬퍼로 빠져 server 테스트가 덮으므로, 여기서는
"그 헬퍼를 어느 자리에서 호출하는가"만 본다. 리더가 아닌 화면이 재생을
시작하는 실수는 순수 함수 테스트로 잡히지 않기 때문이다.

리더 게이트는 `startPlaying` 내부와 각 호출부에 이중으로 걸려 있다. 그래서 한
쪽만 지워도 테스트는 통과한다 — 테스트가 고정하는 것은 개별 가드가 아니라
"리더가 아닌 화면은 `playRec`을 호출하지 않는다"는 관찰 가능한 속성이다.

`customer` 테스트는 손님 신원과 상호작용 판정을 덮는다. visitor ID는 신청 취소
권한의 근거이므로 모든 요청에 실려야 하고, 길게 눌러 링크 복사는 탭과 같은
요소를 공유해 판정이 조금만 어긋나도 정반대로 망가진다. 둘 다 화면을 봐야만
드러나는 종류라 시간과 좌표를 직접 넣어 고정한다. 색상·레이아웃은 대상이
아니다 — 화면 확인이 불가능한 환경에서 스타일을 검증하면 의미 없는 스냅샷만
쌓인다.

`vi.fn()`은 vitest config의 `restoreMocks` 대상이 아니다. 호출 기록에 의존하는
테스트는 `beforeEach`에서 직접 `mockClear()`한다.

린트는 서버·customer·owner에 적용된다. owner는 React 화면뿐 아니라 Electron
메인·preload 프로세스도 검사한다. 규칙은 포맷팅이 아니라 "실행해봐야 아는 실수"만
다룬다(`no-unused-vars`, `no-undef`, `eqeqeq`, React Hooks 등). 포맷터는 두지
않는다 — 기존 스타일이 이미 일관되고, 한 번 돌리면 전 파일이 diff로 뒤집혀
리뷰가 불가능해진다. 기존 effect 의도를 검토하며 도입할 수 있도록
`react-hooks/exhaustive-deps`만 경고이고 나머지 버그성 규칙은 오류다.
정적 `admin`·lab 화면은 아직 린트 대상이 아니다.

`test:unit`은 `vitest.unit.config.mjs`에 명시된 테스트만 실행하며 PostgreSQL에 연결하지 않는다.

```bash
NODE_ENV=test \
DATABASE_URL=postgres://postgres:test@localhost:5432/caffeine_test \
JWT_SECRET=ci-only-secret \
npm test --prefix server
```

CI는 `server-test`(PostgreSQL + 린트 + 단위·통합 테스트)와 `frontend-build`(customer·owner 린트·테스트와 Vite 빌드)를 실행한다. owner 린트가 Electron 메인·preload 프로세스의 구문과 전역 사용도 함께 검사한다.

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

| 값 | 현재 | 역할 |
| --- | --- | --- |
| `ALERT_WINDOW_MS` | 5분 | 집계 창. 이 밖의 발생은 세지 않는다 |
| `DEFAULT_THRESHOLD` | 1 | 창 안에 이만큼 쌓이면 발사 |
| `CODE_THRESHOLDS` | 비어 있음 | 특정 코드만 반복 확인이 필요할 때의 예외 |
| `ALERT_COOLDOWN_MS` | 30분 | 같은 코드 재알림 최소 간격. 코드당 최대 48회/일 |

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

자동 MAEST 워커 설치·실제 곡 비교 명령은 [워커 README](../audio-analysis-worker/README.md#실제-곡-테스트-서버-쓰기-없음)를 따른다. 서버는 20260909100000_maest_runs 마이그레이션까지 배포해야 한다. 공유 DB에 로컬 migrate를 실행하지 않는다. MAEST_ONLY 자동 큐는 ENABLE_VALENCE_AROUSAL을 사용하지 않으며 기존 수동 CLI만 이 옵션을 따른다.

미니PC에 연결된 Claude 세션의 업데이트 순서·시험 완료 기준·실패 진단은 [워커 인수인계](../audio-analysis-worker/README.md#claude-세션-인수인계)를 따른다.
