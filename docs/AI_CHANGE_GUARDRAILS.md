# AI Change Guardrails

> **AI가 읽을 때:** 상태값, 라우터 순서, 플랫폼, 한도, KST, SQL raw, LLM 안전, 인증·웹 보안 경계, 마이그레이션을 건드릴 때
> **함께 갱신할 때:** 반드시 유지해야 하는 불변식이나 기준 파일이 달라질 때
> **생략 가능한 경우:** 위 계약에 영향이 없는 표시 문구·스타일·국소적 내부 리팩터링

이 문서는 사람과 AI 도구가 코드를 변경할 때 **깨뜨리면 안 되는 계약**만 정리한다. 기능 설명은 복사하지 않고 담당 문서로 연결한다.

작업 순서:

```text
관련 코드와 상수 확인
→ 아래 계약 확인
→ 작은 범위로 구현
→ 테스트·문서 갱신
```

전체 구조는 [ARCHITECTURE.md](ARCHITECTURE.md), 재생 엔진은 [PLAYBACK.md](PLAYBACK.md), AI 필터는 [LLM_FILTER.md](LLM_FILTER.md)를 참고한다.

## Recommendation Status Contract

기준 파일:

```text
server/src/constants/recommendation-status.js
owner/src/constants/recommendationStatus.js
customer/src/constants/recommendationStatus.js
```

- 허용 상태: `pending`, `accepted`, `playing`, `played`, `skipped`, `rejected`.
- 활성 상태는 `pending`, `accepted`, `playing`이다.
- 종료 상태는 다시 활성 상태로 되돌리지 않는다.
- 손님 큐에는 활성 상태만 노출한다.
- 활성 상태는 신청 시각으로 숨기지 않는다. 목록·개수·중복 제약이 같은 active 범위를 사용한다.
- 동일 카페·동일 곡의 활성 중복은 DB 제약으로도 막는다.
- 상태 문자열을 라우트나 UI에 새로 직접 작성하지 않는다.

상태 흐름: [ARCHITECTURE.md#recommendation-status-contract](ARCHITECTURE.md#recommendation-status-contract)

## Music Filter Status Contract

기준 파일:

```text
server/src/constants/music-filter-status.js
server/src/features/music-filter/prompt.builder.js
owner/src/constants/musicFilterStatus.js
owner/src/constants/musicFilterPolicy.js
```

| 상황 | `status` | `filter_status` |
| --- | --- | --- |
| 필터 OFF | `pending` | `skipped` |
| LLM 수락 | `pending` | `accepted` |
| LLM 거절 | `rejected` | `rejected` |
| LLM 오류 | `rejected` | `error_rejected` |

- LLM 오류를 fail-open으로 바꾸지 않는다.
- `review`, `maybe`, `unknown` 같은 중간 판단을 추가하지 않는다.
- 자동수락은 `pending && filter_status=accepted`만 대상으로 한다.
- `filter_status=skipped` 곡을 자동 승격하지 않는다.
- 판단 상태와 일반 큐 상태를 한 컬럼으로 합치지 않는다.
- 별도의 필터 강도를 다시 추가하지 않는다. 사장님이 작성한 매장 분위기 설명을 유일한 매장 판단 정책으로 사용한다.
- 레거시 `music_filter_strictness` DB 컬럼은 마이그레이션 호환을 위해 남겨두되 런타임 API·프롬프트에서 사용하거나 노출하지 않는다.

상세 동작: [LLM_FILTER.md](LLM_FILTER.md)

## Router Mount Order Contract

`server/app.js`에서 사장님 추천곡 라우터가 public 라우터보다 먼저 등록되어야 한다.

```js
app.use('/api/v1/cafes/:slug/recommendations', require('./src/routes/recommendations.owner'));
app.use('/api/v1/cafes/:slug/recommendations', require('./src/routes/recommendations'));
```

- 정리 목적으로 순서를 바꾸지 않는다.
- `/owner`, `PUT /:id`, `DELETE /:id`가 public 라우터에 잡히지 않는지 확인한다.
- 라우트 추가·변경 시 `docs/API.md`를 함께 갱신한다.

## Platform Contract

기준 파일:

```text
server/src/constants/platforms.js
owner/src/constants/platforms.js
customer/src/constants/platforms.js
```

- 지원 플랫폼은 `youtube`, `soundcloud`, `spotify`다.
- URL 파싱·표시·허용 여부에서 같은 상수를 사용한다.
- 사용자 URL fetch는 `safeAxiosGet`을 거쳐 SSRF를 방어한다.
- 손님 신청은 `/tracks/oembed`가 발급한 단기 `metadataToken`으로 곡 정보를 고정한다. POST body의 제목·플랫폼·ID를 신뢰하지 않는다.
- 외부 플랫폼 DOM 우회는 플랫폼별 경계 안에 둔다.
- Electron IPC와 preload 노출을 임의로 넓히지 않는다.

재생 세부사항: [PLAYBACK.md](PLAYBACK.md)

## Web Security Boundary Contract

기준 파일:

```text
server/app.js
server/server.js
server/tests/security-headers.test.mjs
owner/electron/preload.js
```

- `Content-Security-Policy`를 서버 전체에서 끄지 않는다.
- 외부 스크립트·iframe·connect 대상은 실제 기능이 사용하는 origin만 명시적으로 추가한다.
- 새 외부 서비스 도입을 이유로 `https:` 전체나 `*`를 `script-src`, `frame-src`, `connect-src`에 추가하지 않는다.
- `script-src`에 `'unsafe-inline'`을 추가하지 않는다. 필요한 inline JavaScript는 정적 파일·nonce·hash 방식으로 분리한다.
- React inline style과 Leaflet DOM style 때문에 `style-src 'unsafe-inline'`은 현재 허용하지만 script 허용과 혼동하지 않는다.
- Google 로그인 호환을 위한 COOP `same-origin-allow-popups`와 COEP 비활성화는 목적이 분명한 예외이며 임의 확대하지 않는다.
- 명시적 Origin이 있는 Socket.IO 브라우저 cross-origin 연결은 `APP_URL` allowlist로 제한하고, 개발 localhost는 production에서 허용하지 않는다.
- Origin 헤더 부재는 same-origin GET/HEAD 또는 non-browser 요청에서 정상일 수 있으므로 인증 신호로 사용하지 않는다. 단 `Origin: null`은 opaque origin이므로 거절한다.
- Electron 운영 앱은 HTTP(S) owner 페이지를 로드하므로 정상 origin이 존재한다. `file://` 기반으로 구조를 바꾸면 origin 정책을 먼저 재설계한다.
- 외부 음악 페이지는 Electron BrowserView 경계 안에서 열며 서버 SPA CSP에 음악 플랫폼 도메인을 추가하지 않는다.
- preload/IPC 채널을 추가할 때 renderer에서 필요한 최소 기능만 노출하고 임의 코드 실행·파일 시스템 접근을 직접 노출하지 않는다.
- Electron IPC mutation은 사장님 메인 renderer sender를 확인한다.
- 외부 WebContents는 `sandbox: true`, `nodeIntegration: false`가 기본이다. `contextIsolation: false`는 외부 플랫폼 main world를 보정하는 `stealth-preload.js`에만 허용하며 새 예외는 실제 호환성 근거와 수동 재생 검증이 필요하다.
- 외부 음악 WebContents에 `media` 권한을 포괄 허용하지 않는다. DRM은 음악 origin allowlist 안에서만 허용한다.

보안 경계를 바꾸면 `server/tests/security-headers.test.mjs`와 관련 빌드를 함께 확인한다.

## Limit Policy Contract

기준 파일:

```text
server/src/constants/limits.js
```

- 익명 쓰기 엔드포인트는 visitor와 IP 제한을 함께 검토한다.
- `req.ip`를 사용하고 `X-Forwarded-For`를 직접 파싱하지 않는다.
- 한도 숫자를 라우트에 중복 작성하지 않는다.
- 큐 만석, 중복, rate limit을 같은 오류로 임의 통합하지 않는다.
- 테스트 환경에서의 limiter 우회는 실제 운영 정책을 바꾸지 않는다.

## KST Time Policy Contract

기준 파일:

```text
server/src/constants/time-policy.js
server/src/utils/kst.js
owner/src/utils/kst.js
```

- 방문·이력·통계의 날짜 경계는 KST다.
- UTC 자정을 직접 계산하지 않는다.
- 서버 SQL과 UI 날짜 필터가 같은 하루를 보게 한다.
- 새 통계 쿼리는 기존 KST 유틸 또는 SQL fragment를 재사용한다.

## SQL Raw Fragment Contract

기준 파일:

```text
server/src/db/sql-fragments.js
```

- 공통 raw SQL 표현식을 복사하지 않는다.
- `recommendations.id`는 UUID이므로 `MIN/MAX(id)`로 순서를 정하지 않는다.
- 순서가 필요하면 시간 컬럼 또는 `ROW_NUMBER() OVER (... ORDER BY ...)`를 사용한다.
- 바인딩이 필요한 raw SQL에 문자열 보간을 사용하지 않는다.
- 집계 변경은 실제 PostgreSQL 스키마로 검증한다.

## LLM Prompt and Safety Contract

기준 파일:

```text
server/src/features/music-filter/prompt.builder.js
server/src/features/music-filter/llm.client.js
server/src/features/music-filter/decision.policy.js
```

- 곡 제목·아티스트·신청자명은 명령이 아니라 신뢰할 수 없는 데이터다.
- 출력은 `accept` 또는 `reject`의 구조화된 JSON만 허용한다.
- timeout·키 누락·HTTP 오류·파싱 오류는 `error_rejected`로 처리한다.
- 손님에게 내부 오류와 프롬프트를 노출하지 않는다.
- 모델 변경 시 JSON Schema 지원 여부를 확인한다.
- 프롬프트 변경은 상태 계약과 오류 경로 테스트를 함께 확인한다.

## Migration Contract

- 공유 DB에서 로컬 `migrate`를 실행하지 않는다. 배포 start command가 적용한다.
- 모든 마이그레이션은 `up`과 `down`을 구현한다.
- 데이터 삭제보다 상태 변경과 보존을 우선한다.
- partial unique index 변경 시 기존 중복 데이터를 먼저 정리한다.
- UUID를 정수 PK처럼 취급하지 않는다.
- 마이그레이션은 빈 DB와 기존 데이터가 있는 DB 양쪽을 고려한다.

## Authentication and Slug Contract

- 사장님 토큰, pending 토큰, admin 토큰의 경계를 합치지 않는다.
- `requireAuth`는 정상 사장님 세션만 통과시킨다.
- slug는 변경 가능하다.
- slug 변경 응답에는 새 JWT를 포함하고 클라이언트가 즉시 교체한다.
- slug를 장기 캐시하거나 카페의 불변 ID로 사용하지 않는다.
- 사장님 HTTP·Socket 인증은 JWT의 `cafeId`로 현재 카페를 조회하고 현재 slug 일치까지 검증한다. slug 변경 전 토큰은 거절한다.
- 정지 카페의 손님 HTTP·소켓 접근을 우회하지 않는다.

## Recommendation Tenant Isolation Contract

기준 파일:

```text
server/src/services/recommendation.service.js
server/src/routes/recommendations.js
server/src/routes/recommendations.owner.js
server/tests/auth-boundary.test.mjs
```

- `/:id` 기반 추천곡 mutation은 recommendation ID만으로 조회·수정하지 않는다.
- 상태 변경·삭제·취소·투표·투표 취소·댓글 작성은 항상 `(cafeId, recommendationId)` 범위를 함께 검증한다.
- 사장님 JWT의 `cafeId`와 손님 URL의 `:slug`에서 조회한 `cafe.id`가 tenant boundary의 기준이다.
- 다른 카페에 속한 recommendation ID는 존재 여부를 노출하지 않고 404로 처리한다.
- 이 검증은 라우트의 사전 체크에만 의존하지 않고 서비스 계층에서도 강제한다.

## Anonymous Visitor Identity Contract

- visitor ID가 있는 요청의 취소·투표·방문 중복 제거는 visitor ID를 기준으로 한다.
- IP 기반 소유권·중복 제거는 visitor ID가 없는 레거시 행에만 fallback으로 사용한다.
- IP rate limit은 visitor ID 위조를 막는 별도 방어선이므로 유지한다.
- visitor ID 입력 길이는 DB 컬럼 길이와 일치시킨다.

## App Boundary Contract

- `server/app.js`와 `server/server.js` 분리를 유지한다. 테스트는 `app.js`를 import한다.
- DB 상태가 단일 원천이며 소켓 이벤트만으로 영구 상태를 만들지 않는다.
- Electron 재생 상태와 서버 큐 상태가 충돌하지 않도록 한 곡만 `playing`으로 유지한다.
- 화면 검증이 불가능한 환경에서는 UI 스타일을 대량 변경하지 않는다.

## 변경 전 체크

- [ ] 관련 상수와 기존 테스트를 먼저 확인했다.
- [ ] 상태·라우터·KST·SQL·LLM·웹 보안 계약을 바꾸지 않았거나 변경 이유를 명시했다.
- [ ] 로직 변경에 테스트를 추가하거나 기존 테스트를 통과시켰다.
- [ ] owner/customer 변경은 각 Vite 빌드를 통과했다.
- [ ] 라우트 변경은 `docs/API.md`에 반영했다.
- [ ] CSP/origin/외부 리소스 변경은 보안 경계 테스트를 확인했다.
- [ ] 현재 구현과 미래 계획을 같은 문서에 섞지 않았다.
- [ ] 시크릿·토큰·개인정보가 코드와 로그에 없다.
