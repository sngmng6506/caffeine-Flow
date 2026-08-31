# API 레퍼런스

> **AI가 읽을 때:** HTTP 경로, 메서드, 인증, 요청·응답, 상태 코드를 추가하거나 변경할 때
> **함께 갱신할 때:** 클라이언트가 의존하는 외부 API 계약이 달라질 때
> **생략 가능한 경우:** 라우트의 외부 동작을 유지한 채 서비스·쿼리 내부만 리팩터링할 때

Base URL은 `/api/v1`이고 응답은 JSON이다. 인증 엔드포인트는 `Authorization: Bearer <JWT>`를 사용한다.

범례: 🔓 공개 · 🔒 사장님 인증 · 🏪 카페 소유자 확인 · 🛡 운영자 · ⏱ 요청 제한

이 문서는 현재 경로와 입출력 요약만 다룬다. 상태 흐름은 [ARCHITECTURE.md](ARCHITECTURE.md), AI 판단은 [LLM_FILTER.md](LLM_FILTER.md), 변경 계약은 [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md)를 참고한다. 정확한 body 필드와 응답 shape는 라우트 코드와 테스트가 최종 기준이다.

## 인증 — `/auth`

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| POST | `/auth/google` | 🔓 | Google idToken 로그인 |
| GET | `/auth/naver` | 🔓 | Naver OAuth 시작 |
| GET | `/auth/naver/callback` | 🔓 | OAuth 콜백 후 앱으로 이동 |
| POST | `/auth/complete` | 🔓 | pending token으로 신규 가입 완료 |

기존 회원 응답은 `{ token, cafe }`, 신규 회원은 `{ needsSetup: true, pendingToken }`이다. 사용 완료된 pending token 재사용과 동일 provider 가입 경합은 409로 로그인 재시도를 안내한다.

## 카페 관리 — `/cafes`

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/cafes/me` | 🔒 | 내 카페 정보 |
| GET | `/cafes/me/qr-code` | 🔒 | 손님용 QR 이미지 다운로드 |
| PUT | `/cafes/me` | 🔒 | 카페명 등 기본 정보 변경 |
| PUT | `/cafes/me/platforms` | 🔒 | 허용 플랫폼 변경 |
| PUT | `/cafes/me/music-filter` | 🔒 | AI 필터 사용 여부·매장 분위기 설명 설정 |
| PUT | `/cafes/me/address` | 🔒 | 지역·좌표 변경 |
| PUT | `/cafes/me/slug` | 🔒 | QR slug 재발급·지정 |
| PUT | `/cafes/me/status` | 🔒 | 신청 접수 ON/OFF |
| GET | `/cafes/me/history` | 🔒 | 재생 이력. 처리 최신순, `?date=`는 처리일의 KST 기준 |
| POST | `/cafes/me/playback-history` | 🔒 | 브라우저 직접 재생곡 종료 보고 |
| GET | `/cafes/me/stats` | 🔒 | 종합 통계와 TOP10 |
| GET | `/cafes/me/stats/music-filter` | 🔒 | 최근 AI 필터 처리 현황 |
| GET | `/cafes/me/stats/daily` | 🔒 | 일별 통계 `?date=` |
| GET | `/cafes/me/stats/hourly` | 🔒 | 시간대별 패턴 |
| GET | `/cafes/me/stats/weekday` | 🔒 | 요일별 패턴 |
| GET | `/cafes/me/stats/hourly-songs` | 🔒 | 특정 시간대 곡 `?hour=` |
| GET | `/cafes/me/stats/weekday-songs` | 🔒 | 특정 요일 곡 `?day=` |

- `GET /cafes/me`와 `PUT /cafes/me/slug` 응답은 최초 가입 slug를 `initial_slug`로 반환한다. slug 변경 응답에는 새 JWT가 포함되며 클라이언트가 즉시 교체해야 한다.
- 매장 분위기 설명이 바뀌면 손님용 신청곡 안내를 한 번 생성해 저장한다. 생성 실패 시 설정 저장을 중단한다.
- 직접 재생곡은 정상 종료 또는 60초 이상 재생만 이력에 저장한다.

## 추천곡 — `/cafes/:slug/recommendations`

### 손님

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/` | 🔓 | 활성 큐 조회와 방문 기록 |
| POST | `/` | 🔓 ⏱ | 신청곡 등록. `metadataToken`과 선택적 `requesterName`을 받아 중복·큐 한도·AI 필터 적용 |
| GET | `/history` | 🔓 | 최근 7일의 재생·건너뜀 이력 `?offset=` |
| GET | `/top10` | 🔓 | 실제 재생된 곡의 매장 순위 `?offset=&sort=count\|votes` |
| DELETE | `/:id/cancel` | 🔓 | 본인 신청 취소 |
| POST | `/:id/vote` | 🔓 ⏱ | 투표 |
| DELETE | `/:id/vote` | 🔓 ⏱ | 투표 취소 |
| POST | `/:id/comments` | 🔓 ⏱ | 신청곡 댓글 |

### 사장님

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/owner` | 🏪 | AI 판단 정보를 포함한 활성 큐 조회 |
| POST | `/owner` | 🏪 | 사장님 직접 신청. AI 필터 우회 |
| PUT | `/:id` | 🏪 | 상태 변경 |
| DELETE | `/:id` | 🏪 | 신청곡 삭제 |

계약:

- 사장님 라우터를 public 라우터보다 먼저 마운트한다.
- `/:id` 기반 mutation은 URL `:slug`가 가리키는 카페 범위에서만 조회·수정한다. 다른 카페의 ID는 존재 여부와 무관하게 404다.
- 공개 응답은 화면에 필요한 곡·상태·투표·시각 필드만 반환한다. `requester_ip`, `visitor_id`, AI 모델·confidence·오류 코드는 공개 HTTP와 공용 소켓 이벤트에 넣지 않으며 사장님 응답도 IP와 visitor ID를 반환하지 않는다.
- `is_mine`은 요청의 `X-Visitor-Id`와 저장값을 서버가 비교한 boolean이다. 손님 취소도 이 값이 일치할 때만 허용한다.
- 공개 큐 조회의 `notice`는 사장님 원본 설명이 아니라 저장된 손님용 신청곡 안내다. 조회 시 LLM을 호출하지 않으며 수동 공지 변경 API는 없다.
- `metadataToken`은 `GET /tracks/oembed`가 확인한 곡 정보에 5분 서명을 붙인 값이다. body의 `videoId`, `title`, `platform`은 신뢰하지 않고 만료·변조 토큰은 400이다.

## 곡 댓글 — `/songs/:videoId/comments`

`/cafes/:slug/songs/:videoId/comments`에서도 같은 곡 댓글에 접근한다. 카페 경로는 활성 카페만 허용하고 잘못된 slug는 404다.

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/` | 🔓 | 댓글 목록 |
| POST | `/` | 🔓 ⏱ | 댓글 작성 |
| POST | `/:commentId/replies` | 🔓 ⏱ | 답글 작성 |

- GET은 `?offset=0&limit=20`을 받고 `limit` 최대값은 50이다. 응답은 `{ items, hasMore, nextOffset }`이며 최상위 댓글은 최신순, `replies`는 작성순이다.
- `:commentId`는 URL `:videoId`에 속한 최상위 댓글이어야 한다.
- 모든 댓글 응답에서 `commenter_ip`와 `visitor_id`를 제외한다.
- `videoId`가 전체 URL인 SoundCloud·Spotify는 클라이언트가 단일 path segment로 URL 인코딩해 전달한다.
- 직접 재생곡 댓글은 재생 세션 키로 저장하고, 종료 보고에서 실제 곡 ID가 확인되면 같은 카페 범위에서 곡 키로 병합한다.

## 트랙 메타데이터 — `/tracks`

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/tracks/oembed?url=` | 🔓 | 음악 URL을 공통 트랙 메타데이터로 변환하고 5분 유효 `metadataToken` 발급 |

사용자 URL 요청은 `safeAxiosGet`을 거쳐 SSRF를 방어한다.

사장님 JWT는 불변 `cafeId`로 카페를 조회한 뒤 토큰의 slug가 현재 slug와 같은지 확인한다. slug 변경 전에 발급된 토큰은 401이다.

## 운영자 — `/admin`

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| POST | `/admin/login` | 🔓 | 운영자 로그인, 12시간 토큰. IP별 15분 10회·전체 15분 50회 실패 제한, 차단 시 `retry_after_seconds` 반환 |
| POST | `/admin/music-filter/test` | 🛡 | 필터 테스트에서 저장 없이 곡 판단. body는 `url`, `prompt`, 선택적 `model` |
| GET | `/admin/music-filter/models` | 🛡 | OpenRouter `/models/user` 목록을 10분 캐시해 반환 |
| GET | `/admin/music-filter-reviews` | 🛡 | `Playlist`·`플리` 제목을 제외한 전체 카페 라벨링 큐와 전체·완료·미검수 건수. `view`, `offset` 지원 |
| GET | `/admin/music-filter-artist-labels` | 🛡 | 확인한 아티스트의 다른 곡 라벨 최신 3건. `artist`, 선택적 `platform`·`track_key` |
| GET | `/admin/cafes` | 🛡 | 전체 카페와 운영 상태, 오늘 QR 접속 브라우저 수(`today_unique_browsers`) |
| GET | `/admin/cafes/:id/stats` | 🛡 | 특정 카페의 오늘·누적·시간대·요일·AI 필터 통계 |
| GET | `/admin/cafes/:id/music-filter-audit` | 🛡 | 현재 AI 필터 설정, 프롬프트 변경 이력 50건, 판단 이력 50건. `offset` 지원 |
| PUT | `/admin/cafes/:id/music-filter-audit/:recommendationId/review` | 🛡 | 정책 검수와 선택적 곡 특성 라벨 저장·갱신 |
| PUT | `/admin/cafes/:id/suspend` | 🛡 | 카페 정지·해제 |
| DELETE | `/admin/cafes/:id` | 🛡 | 카페와 종속 데이터 삭제 |

- 잘못된 UUID와 미존재 카페는 404다. 정지 카페는 손님 HTTP와 Socket.IO 접근이 차단된다.
- 검수 body는 `{ human_decision, human_reason_code, metadata_sufficient, track_annotation? }`다. `metadata_sufficient`는 `boolean|null`이며 `null`은 미확인이다. 나머지 허용값은 `server/src/constants/music-filter-review.js`와 `server/src/constants/music-labeling.js`가 기준이며 분위기·장르는 각각 최대 2개, `unknown`은 단독으로만 쓴다.
- 해당 카페의 AI 처리 이력만 검수할 수 있고, 사람 라벨은 신청곡 상태나 LLM 판단을 바꾸지 않는다.
- 곡 라벨은 `(platform, track_key)`당 한 건으로 upsert한다.
- 라벨링 큐 `view`는 `unreviewed`(기본), `reviewed`, `all`이며 최근 판단순 50건을 반환한다. 정책 검수와 곡 라벨이 모두 있어야 `reviewed`다. 저장하면 미검수 목록이 줄어들므로 다음 묶음은 `offset=0`부터 다시 조회한다. 제목에 대소문자 구분 없이 `Playlist` 또는 `플리`가 포함된 항목은 모든 view와 집계에서 제외한다.

## 통합 TOP10과 헬스체크

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/api/v1/top10?offset=&sort=count\|votes` | 🔓 | 정지 카페를 제외하고 실제 재생된 곡만 집계한 전체 순위 |
| GET | `/health` | 🔓 | 서버 상태와 버전 |

`sort=count`는 재생 횟수, `sort=votes`는 좋아요 합계 기준이다. 서버가 전체 집계를 정렬한 뒤 페이지를 자르고, 동률은 다른 지표와 정규화 곡 ID 순으로 결정해 페이지 사이 순서가 흔들리지 않는다.

## 공통 입력 규칙과 상태 코드

- `offset`은 0 이상 10,000 이하 정수만 허용한다. 음수, 일부만 숫자인 문자열, 상한 초과는 400이다.
- `date`는 실제 달력에 존재하는 `YYYY-MM-DD`만, 좌표는 위도 -90~90·경도 -180~180의 유한한 숫자만 허용한다.
- 존재하지 않는 `/api/*` 경로는 SPA HTML이 아니라 `{ "error": "API endpoint not found" }` JSON 404를 반환한다.

| 코드 | 의미 |
| --- | --- |
| 400 | 입력 검증 실패 |
| 401 | 인증 실패 |
| 403 | 권한 없음 또는 정책상 거절 |
| 404 | 리소스 없음 또는 현재 카페 범위 밖 리소스 |
| 409 | 중복 또는 허용되지 않는 상태 전이 |
| 429 | 요청 제한 또는 큐 한도 |
| 500 | 서버 오류 |
| 503 | 외부 AI 판단 실패 |
