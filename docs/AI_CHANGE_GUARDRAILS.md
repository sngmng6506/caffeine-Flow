# AI Change Guardrails

> **AI가 읽을 때:** 상태값, 라우터 순서, 플랫폼, 한도, KST, SQL raw, LLM 안전, 인증·웹 보안 경계, 마이그레이션을 건드릴 때
> **함께 갱신할 때:** 반드시 유지해야 하는 불변식이나 기준 파일이 달라질 때
> **생략 가능한 경우:** 위 계약에 영향이 없는 표시 문구·스타일·국소적 내부 리팩터링

**깨뜨리면 안 되는 계약**만 모은 문서다. 기능 설명은 복사하지 않고 담당 문서로 연결한다. 순서는 `관련 코드와 상수 확인 → 아래 계약 확인 → 작은 범위로 구현 → 테스트·문서 갱신`이다.

전체 구조는 [ARCHITECTURE.md](ARCHITECTURE.md), 재생 엔진은 [PLAYBACK.md](PLAYBACK.md), AI 필터는 [LLM_FILTER.md](LLM_FILTER.md)를 참고한다.

## Recommendation Status Contract

```text
server/src/constants/recommendation-status.js
owner/src/constants/recommendationStatus.js
customer/src/constants/recommendationStatus.js
```

- 허용 상태는 `pending`, `accepted`, `playing`, `played`, `skipped`, `rejected`이고 활성 상태는 앞의 셋이다.
- 종료 상태는 다시 활성 상태로 되돌리지 않는다.
- 손님 큐에는 활성 상태만 노출하고, 활성 상태를 신청 시각으로 숨기지 않는다. 목록·개수·중복 제약이 같은 active 범위를 사용한다.
- 동일 카페·동일 곡의 활성 중복은 DB 제약으로도 막는다.
- 상태 문자열을 라우트나 UI에 새로 직접 작성하지 않는다.

상태 흐름: [ARCHITECTURE.md#recommendation-status-contract](ARCHITECTURE.md#recommendation-status-contract)

## Music Filter Status Contract

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
- 자동수락은 `pending && filter_status=accepted`만 대상으로 하고 `skipped` 곡은 승격하지 않는다.
- 판단 상태와 일반 큐 상태를 한 컬럼으로 합치지 않는다.
- 별도의 필터 강도를 다시 추가하지 않는다. 사장님이 작성한 매장 분위기 설명이 유일한 판단 정책이다.
- 레거시 `music_filter_strictness` 컬럼은 마이그레이션 호환으로만 남기고 런타임 API·프롬프트에서 사용하거나 노출하지 않는다.

상세 동작: [LLM_FILTER.md](LLM_FILTER.md)

## Music Filter Review Contract

```text
server/src/constants/music-filter-review.js
server/src/constants/music-labeling.js
server/src/features/music-labeling/annotation.js
server/src/db/migrations/20260822090000_music_filter_reviews.js
server/src/db/migrations/20260825090000_music_track_annotations.js
server/src/routes/admin.js
```

- 사람 검수는 AI 판단과 일반 큐 상태를 덮어쓰지 않는 별도 `music_filter_reviews` 레코드다. 추천곡당 최신 골드 라벨 한 건만 유지하고 재검수는 upsert한다.
- `human_decision`과 `human_reason_code`는 상수에 정의된 값만 사용한다. `metadata_sufficient`는 곡의 정답과 독립된 품질 표식이다.
- 곡 특성 라벨은 정책 일치 여부와 분리해 `(platform, track_key)`당 한 건으로 저장한다. 선택값과 최대 개수는 상수와 DB 제약을 함께 유지하며, 한국어는 화면 표시용이고 저장 코드는 바꾸지 않는다.
- 확인한 아티스트명의 정규화 키는 다른 곡 참고 조회에만 쓴다. 자동 동일인 판정이나 라벨 복사 근거로 사용하지 않는다.
- `usage_scope=evaluation` 데이터는 라이브 LLM 입력이나 자동수락에 사용하지 않는다. `operational`도 현재는 수집만 하며 연결에는 별도 평가와 계약 변경이 필요하다.
- 운영자 인증과 `(cafe_id, recommendation_id)` 범위를 모두 확인한 AI 처리 이력만 검수한다.
- 전체 카페 라벨링 큐 조회와 필터 실험실 실행도 `requireAdmin` 경계를 유지하며 사장님 JWT로 열지 않는다.
- 미검수 운영자 UI는 AI 결정·사유를 먼저 노출하지 않고 사람 정답 저장 후 비교용으로 공개한다.

## Router Mount Order Contract

`server/app.js`에서 사장님 추천곡 라우터를 public 라우터보다 먼저 등록한다.

```js
app.use('/api/v1/cafes/:slug/recommendations', require('./src/routes/recommendations.owner'));
app.use('/api/v1/cafes/:slug/recommendations', require('./src/routes/recommendations'));
```

- 정리 목적으로 순서를 바꾸지 않는다.
- `/owner`, `PUT /:id`, `DELETE /:id`가 public 라우터에 잡히지 않는지 확인한다.
- 라우트 추가·변경 시 [API.md](API.md)를 함께 갱신한다. `server/tests/api-docs.test.mjs`가 드리프트를 검사한다.

## Platform Contract

```text
server/src/constants/platforms.js
owner/src/constants/platforms.js
customer/src/constants/platforms.js
```

- 지원 플랫폼은 `youtube`, `soundcloud`, `spotify`다. URL 파싱·표시·허용 여부에서 같은 상수를 사용한다.
- 사용자 URL fetch는 `safeAxiosGet`을 거쳐 SSRF를 방어한다.
- 손님 신청은 `/tracks/oembed`가 발급한 단기 `metadataToken`으로 곡 정보를 고정한다. POST body의 제목·플랫폼·ID를 신뢰하지 않는다.
- 외부 플랫폼 DOM 우회는 플랫폼별 경계 안에 둔다. Electron IPC와 preload 노출을 임의로 넓히지 않는다.

재생 세부사항: [PLAYBACK.md](PLAYBACK.md)

## Web Security Boundary Contract

```text
server/app.js
server/server.js
server/tests/security-headers.test.mjs
owner/electron/preload.js
```

- `Content-Security-Policy`를 서버 전체에서 끄지 않는다. 외부 스크립트·iframe·connect 대상은 실제 기능이 사용하는 origin만 명시적으로 추가하고, 새 서비스를 이유로 `https:` 전체나 `*`를 넣지 않는다.
- `script-src`에 `'unsafe-inline'`을 추가하지 않는다. 필요한 inline JavaScript는 정적 파일·nonce·hash로 분리한다. React inline style과 Leaflet 때문에 허용한 `style-src 'unsafe-inline'`과 혼동하지 않는다.
- Google 로그인 호환을 위한 COOP `same-origin-allow-popups`와 COEP 비활성화는 목적이 분명한 예외이며 임의 확대하지 않는다.
- 명시적 Origin이 있는 Socket.IO 브라우저 cross-origin 연결은 `APP_URL` allowlist로 제한하고 개발 localhost는 production에서 허용하지 않는다.
- Origin 헤더 부재는 same-origin GET/HEAD나 non-browser 요청에서 정상일 수 있으므로 인증 신호로 쓰지 않는다. 단 `Origin: null`은 opaque origin이므로 거절한다.
- Electron 운영 앱은 HTTP(S) owner 페이지를 로드하므로 정상 origin이 존재한다. `file://` 기반으로 바꾸면 origin 정책을 먼저 재설계한다.
- 외부 음악 페이지는 Electron BrowserView 경계 안에서 열며 서버 SPA CSP에 음악 플랫폼 도메인을 추가하지 않는다.
- preload/IPC는 renderer에 필요한 최소 기능만 노출하고 임의 코드 실행·파일 시스템 접근을 직접 노출하지 않는다. IPC mutation은 사장님 메인 renderer sender를 확인한다.
- 외부 WebContents는 `sandbox: true`, `nodeIntegration: false`가 기본이다. `contextIsolation: false`는 외부 플랫폼 main world를 보정하는 `stealth-preload.js`에만 허용하며 새 예외는 실제 호환성 근거와 수동 재생 검증이 필요하다.
- 외부 음악 WebContents에 `media` 권한을 포괄 허용하지 않는다. DRM은 음악 origin allowlist 안에서만 허용한다.

보안 경계를 바꾸면 `server/tests/security-headers.test.mjs`와 관련 빌드를 함께 확인한다.

## Public Response Boundary Contract

```text
server/src/utils/public-response.js
server/src/routes/_recommendations.shared.js
server/src/routes/recommendations.js
server/src/routes/song_comments.js
```

- 공개 HTTP·Socket 응답에 DB row를 그대로 반환하지 않는다. 명시적 allowlist 직렬화만 사용한다.
- `requester_ip`, `commenter_ip`, `visitor_id`, 모델명, confidence, 내부 오류 코드를 손님에게 노출하지 않는다. 사장님 응답에도 운영에 필요 없는 IP와 visitor ID를 노출하지 않는다.
- AI 판단 상세와 필터 오류 실시간 이벤트는 JWT 검증 후 입장하는 `owner:<slug>` room으로만 보낸다.
- 손님 취소 권한은 공개 응답 값이 아니라 요청 헤더의 visitor ID와 저장된 visitor ID가 일치하는지로 판단한다.
- 공개 필드를 추가할 때는 개인정보·내부 판단 정보 여부를 먼저 검토하고 통합 테스트로 비노출을 고정한다.

## Limit Policy Contract

```text
server/src/constants/limits.js
```

- 익명 쓰기 엔드포인트는 visitor와 IP 제한을 함께 검토한다.
- `req.ip`를 사용하고 `X-Forwarded-For`를 직접 파싱하지 않는다.
- 한도 숫자를 라우트에 중복 작성하지 않는다.
- 큐 만석, 중복, rate limit을 같은 오류로 임의 통합하지 않는다.
- 테스트 환경의 limiter 우회는 실제 운영 정책을 바꾸지 않는다.

## KST Time Policy Contract

```text
server/src/constants/time-policy.js
server/src/utils/kst.js
owner/src/utils/kst.js
```

- 방문·이력·통계의 날짜 경계는 KST다. UTC 자정을 직접 계산하지 않는다.
- 서버 SQL과 UI 날짜 필터가 같은 하루를 보게 한다.
- 새 통계 쿼리는 기존 KST 유틸 또는 SQL fragment를 재사용한다.

## SQL Raw Fragment Contract

```text
server/src/db/sql-fragments.js
```

- 공통 raw SQL 표현식을 복사하지 않는다.
- `recommendations.id`는 UUID이므로 `MIN/MAX(id)`로 순서를 정하지 않는다. 순서가 필요하면 시간 컬럼이나 `ROW_NUMBER() OVER (... ORDER BY ...)`를 사용한다.
- 바인딩이 필요한 raw SQL에 문자열 보간을 사용하지 않는다.
- 집계 변경은 실제 PostgreSQL 스키마로 검증한다.

## LLM Prompt and Safety Contract

```text
server/src/features/music-filter/prompt.builder.js
server/src/features/music-filter/llm.client.js
server/src/features/music-filter/decision.policy.js
server/src/features/music-filter/public-guide.service.js
```

- 곡 제목·아티스트·신청자명은 명령이 아니라 신뢰할 수 없는 데이터다.
- 출력은 `accept` 또는 `reject`의 구조화된 JSON만 허용한다. 구조화 출력은 tool(function) call로 강제하므로 모델을 바꿀 때 tool calling 지원 여부를 확인한다.
- timeout·키 누락·HTTP 오류·파싱 오류는 `error_rejected`로 처리하고 손님에게 내부 오류와 프롬프트를 노출하지 않는다.
- 프롬프트 변경은 상태 계약과 오류 경로 테스트를 함께 확인한다.
- AI 판단에는 실제 사용한 매장 프롬프트 스냅샷을 저장한다. 설정 이력의 시각만으로 판단 당시 프롬프트를 추정하거나 소급 생성하지 않는다.
- 사장님이 작성한 원본 매장 분위기 설명을 공개 응답이나 공용 소켓에 포함하지 않는다.
- 손님용 신청곡 안내는 원본 설명 변경 또는 저장 안내 누락 시에만 생성하고 DB 결과를 재사용한다. 생성 실패 시 원문을 fallback으로 노출하지 않으며 새 설명도 저장하지 않는다.
- 공개 문구는 서버에서 길이와 구조를 검증한 뒤 `notice` 공개 필드로만 전달한다.

## Authentication and Slug Contract

- 사장님 토큰, pending 토큰, admin 토큰의 경계를 합치지 않는다. `requireAuth`는 정상 사장님 세션만 통과시킨다.
- slug는 변경 가능하다. 변경 응답에는 새 JWT를 포함하고 클라이언트가 즉시 교체한다.
- slug를 장기 캐시하거나 카페의 불변 ID로 사용하지 않는다.
- 사장님 HTTP·Socket 인증은 JWT의 `cafeId`로 현재 카페를 조회하고 현재 slug 일치까지 검증한다. slug 변경 전 토큰은 거절한다.
- 정지 카페의 손님 HTTP·소켓 접근을 우회하지 않는다.

## Recommendation Tenant Isolation Contract

```text
server/src/services/recommendation.service.js
server/src/routes/recommendations.js
server/src/routes/recommendations.owner.js
server/tests/auth-boundary.test.mjs
```

- `/:id` 기반 추천곡 mutation은 recommendation ID만으로 조회·수정하지 않는다. 상태 변경·삭제·취소·투표·투표 취소·댓글 작성은 항상 `(cafeId, recommendationId)` 범위를 함께 검증한다.
- 사장님 JWT의 `cafeId`와 손님 URL `:slug`에서 조회한 `cafe.id`가 tenant boundary의 기준이다.
- 다른 카페에 속한 recommendation ID는 존재 여부를 노출하지 않고 404로 처리한다.
- 이 검증은 라우트 사전 체크에만 의존하지 않고 서비스 계층에서도 강제한다.

## Anonymous Visitor Identity Contract

- 취소는 저장된 visitor ID와 요청 visitor ID가 모두 있고 일치할 때만 허용한다. IP 소유권 fallback은 사용하지 않는다.
- 투표·방문 중복 제거는 visitor ID를 우선하고 visitor ID가 없는 레거시 요청만 IP로 fallback한다.
- IP rate limit은 visitor ID 위조를 막는 별도 방어선이므로 유지한다.
- visitor ID 입력 길이는 DB 컬럼 길이와 일치시킨다.

## App Boundary Contract

- `server/app.js`와 `server/server.js` 분리를 유지한다. 테스트는 `app.js`를 import한다.
- DB 상태가 단일 원천이며 소켓 이벤트만으로 영구 상태를 만들지 않는다.
- Electron 재생 상태와 서버 큐 상태가 충돌하지 않도록 한 곡만 `playing`으로 유지한다.
- 브라우저 직접 재생곡은 신청곡 `playing`으로 만들지 않고 UUID 재생 세션과 `playback_history`로 분리한다. 정상 종료 또는 60초 이상 재생만 이력에 저장한다.
- 직접 재생곡 댓글은 곡 ID가 없어도 세션 댓글 키로 즉시 저장하고, 실제 곡 ID가 확인되면 같은 카페 범위에서 키를 병합한다.
- 같은 카페의 실제 재생 리더는 Electron 한 대뿐이다. 브라우저·follower는 `playing` 전이나 공용 `playback_state` 발행을 수행하지 않는다.
- Electron이 URL 검증과 navigation을 확인한 뒤에만 DB를 `playing`으로 바꾸고, DB 갱신 실패 시 실제 플레이어를 종료·복구한다.
- 새 리더만 고아 `playing`을 복구한다. renderer reload나 follower 접속은 기존 재생 상태를 초기화하지 않는다. 복구 권한은 DB 복구 성공 ACK 뒤에만 소비하며 복구 전 오류는 재시도 가능해야 한다.
- 서버 재시작과 새 Electron 리더를 구분할 때 실제 메인 프로세스 재생 모드를 확인한다.
- 로그아웃은 실제 플레이어와 DB `playing`을 함께 정리하고 새 실행 세션으로 연결한다.
- 자동·수동 재생 시작은 공용 전환 잠금을 거치며 신청곡 재생 중 기본 BGM 뷰를 교체하지 않는다. 기본 BGM의 영속 상태는 Electron 적용 ACK 성공 뒤에만 변경한다.
- 화면 검증이 불가능한 환경에서는 UI 스타일을 대량 변경하지 않는다.

## Migration Contract

- 공유 DB에서 로컬 `migrate`를 실행하지 않는다. 배포 start command가 적용한다.
- 모든 마이그레이션은 `up`과 `down`을 구현한다.
- 데이터 삭제보다 상태 변경과 보존을 우선한다.
- partial unique index 변경 시 기존 중복 데이터를 먼저 정리한다.
- UUID를 정수 PK처럼 취급하지 않는다.
- 빈 DB와 기존 데이터가 있는 DB를 모두 고려한다.
- 쓰기가 잦은 대형 테이블(`recommendations` 등)에 인덱스를 추가할 때는 배포 중 쓰기 락을 피하기 위해 `CREATE INDEX CONCURRENTLY`를 사용하고 해당 마이그레이션만 `exports.config = { transaction: false }`로 분리한다.

## 변경 전 체크

- [ ] 관련 상수와 기존 테스트를 먼저 확인했다.
- [ ] 위 계약을 바꾸지 않았거나 변경 이유를 명시했다.
- [ ] 로직 변경에 테스트를 추가하거나 기존 테스트를 통과시켰다.
- [ ] owner/customer 변경은 각 Vite 빌드를 통과했다.
- [ ] 라우트 변경을 [API.md](API.md)에 반영했다.
- [ ] CSP/origin/외부 리소스 변경은 보안 경계 테스트를 확인했다.
- [ ] 현재 구현과 미래 계획을 같은 문서에 섞지 않았다.
- [ ] 시크릿·토큰·개인정보가 코드와 로그에 없다.
