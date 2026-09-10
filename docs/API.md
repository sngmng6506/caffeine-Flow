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
| POST | `/songs/:trackKey/vote` | 🔓 ⏱ | 곡 좋아요. TOP 목록처럼 신청곡 ID가 없는 화면에서 사용 |
| DELETE | `/songs/:trackKey/vote` | 🔓 ⏱ | 곡 좋아요 취소 |
| POST | `/:id/vote` | 🔓 ⏱ | 좋아요. 서버가 곡 키로 바꿔 위 경로와 같은 표를 쓴다 |
| DELETE | `/:id/vote` | 🔓 ⏱ | 좋아요 취소 |
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
| POST | `/admin/alert-test` | 🛡 | 에러 알림 전송 확인. 실제 알림 경로로 보내며 전용 코드라 진짜 장애의 쿨다운을 건드리지 않는다 |
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
- 검수 body는 `{ human_decision, human_reason_code, metadata_sufficient, audio_analysis_id?, audio_analysis_revision?, track_annotation? }`다. `metadata_sufficient`는 `boolean|null`이며 `null`은 미확인이다. 화면에 표시한 최신 자동 분석 ID를 함께 보내면 해당 곡·분석 한 건만 `reviewed`로 바뀐다. 나머지 허용값은 `server/src/constants/music-filter-review.js`와 `server/src/constants/music-labeling.js`가 기준이며 분위기·장르는 각각 최대 2개, `unknown`은 단독으로만 쓴다.
- 해당 카페의 AI 처리 이력만 검수할 수 있고, 사람 라벨은 신청곡 상태나 LLM 판단을 바꾸지 않는다.
- 곡 라벨은 `(platform, track_key)`당 한 건으로 upsert한다.
- 라벨링 큐 `view`는 `unreviewed`(기본), `reviewed`, `all`이며 최근 판단순 50건을 반환한다. 정책 검수와 곡 라벨이 모두 있어야 `reviewed`다. 저장하면 미검수 목록이 줄어들므로 다음 묶음은 `offset=0`부터 다시 조회한다. 제목에 대소문자 구분 없이 `Playlist` 또는 `플리`가 포함된 항목은 모든 view와 집계에서 제외한다.

## 오디오 분석 워커 — `/audio-analysis`

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| POST | `/audio-analysis/results` | 워커 | 권리가 확인된 로컬 음원에서 추출한 Essentia 특징과 추천 라벨을 곡·모델 버전별 upsert |

- `Authorization: Bearer <AUDIO_ANALYSIS_WORKER_TOKEN>` 전용 경계이며 관리자·사장님 JWT를 재사용하지 않는다. 토큰 미설정 시 503이다.
- body는 `platform`, `track_key`, `model_name`, `model_version`, `feature_schema_version`, `rights_basis`, `source_reference`, `features`, `suggested_annotation`, `analyzed_at`을 받는다.
- `rights_basis`는 `owned`, `licensed`, `public_domain`, `other_authorized`, `platform_stream`을 허용한다. `platform_stream`은 허가 증명이 아닌 다운로드 출처 구분이다. 오디오 파일이나 외부 다운로드 URL은 받지 않는다.
- 동일한 `(platform, track_key, model_name, model_version)` 결과는 갱신되고 다시 `pending` 검수 상태가 된다.
- 라벨링 큐는 곡별 최신 분석을 `audio_analysis`로 반환한다. 새 분석이 `pending`이면 기존 수동 라벨이 있어도 미검수 목록에 다시 나타나며, 수동 곡 라벨 저장 시 `reviewed`가 된다.

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

## 자동 라벨링 작업과 검토

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| POST | `/audio-analysis/jobs/:id/resume` | 워커 | lease_token으로 기존 결과 전송 재개. 인계 전 만료 lease 갱신, 이미 완료면 completed |
| POST | `/audio-analysis/jobs/claim` | 워커 | 대기 작업 1건을 20분 lease로 획득. 없으면 204 |
| POST | `/audio-analysis/jobs/:id/complete` | 워커 | `lease_token`, `result`, `automatic_annotation`, `tag_scores`, `maest_run` 제출. 분석·자동 라벨·작업 완료를 한 트랜잭션에 저장 |
| POST | `/audio-analysis/jobs/:id/fail` | 워커 | `lease_token`, `error_code` 제출. 오류 분류에 따라 지연 재시도 또는 중단 |
| POST | `/audio-analysis/discoveries/claim` | 워커 | 대기 중인 수집 요청 1건을 20분 lease로 획득. 없으면 204 |
| POST | `/audio-analysis/discoveries/:id/complete` | 워커 | `lease_token`과 `tracks[]` 제출. 곡을 분석 큐에 등록하고 중복은 무시한다 |
| POST | `/audio-analysis/discoveries/:id/fail` | 워커 | `lease_token`, `error_code` 제출. 최대 3회 재시도 |
| GET | `/admin/audio-labels` | 🛡 | 모든 신청곡을 플랫폼·곡별 중복 제거해 조회. `view=ready|unreviewed|reviewed|all`, `offset`, 50건. 작업 상태도 반환 |
| GET | `/admin/audio-labels/:id/runs` | 🛡 | 해당 곡의 최근 원본 이력 ID·시각 최대 100건 |
| GET | `/admin/audio-runs/:id` | 🛡 | 실행별 전체 원본 JSON. lease 토큰 제외, 수정 API 없음 |
| POST | `/admin/audio-labels/:id/requeue` | 🛡 | generation을 비교해 실패 재시도·완료곡 재분석 등록. 처리 중은 409, Spotify는 400 |
| POST | `/admin/audio-labels/:id/renormalize` | 🛡 | generation, analysis_id, analysis_revision을 비교해 원본에 현재 택소노미 적용. 원본·사람 라벨 보존 |
| PUT | `/admin/audio-labels/:id/review` | 🛡 | 작업 ID에 해당하는 곡의 라벨 확인·수정. 매장 정책 판단 불필요 |
| GET | `/admin/audio-discoveries` | 🛡 | 최근 최신곡 수집 요청 목록 |
| POST | `/admin/audio-discoveries` | 🛡 | 수집 요청. body는 `{ source, query?, limit? }`. 같은 소스가 대기 중이면 기존 요청을 200으로 돌려준다 |
| GET | `/admin/audio-settings` | 🛡 | 3단 Audio LLM 스위치 조회 |
| PUT | `/admin/audio-settings` | 🛡 | 스위치 변경. body는 `{ audio_llm_enabled: boolean }` |

- 곡별 최신 분석의 `maest_summary`에는 상위 10개(mean·max)와 소비 프롬프트용 `prompt_styles`가 들어간다. `prompt_styles`는 1위 점수의 0.5배 이상인 스타일 최대 5개이며 `prompt_style_calibrated`는 항상 false다.

- 최신곡 수집은 곡 목록 조회와 플랫폼 검색을 워커가 한다. 서버에 yt-dlp가 없고 Railway 공용 IP에서 검색을 반복하면 막힐 수 있다. claim 응답의 `offset`부터 `requested_limit`개를 훑고, 완료 시 `offset`과 실제로 훑은 `scanned`를 함께 보고한다. `scanned`가 요청 개수보다 작으면 소스를 끝까지 본 것이라 진도가 0으로 돌아간다. `enqueued_count`는 새로 등록된 곡 수이며 이미 있던 곡은 세지 않는다.
- 길이가 계약 범위(`audio_duration_sec`) 밖이면 워커가 다운로드 전에 `SOURCE_UNSUPPORTED`로 실패시키며 재시도하지 않는다.
- 3단 Audio LLM 실행 여부는 서버 설정이 정한다. `/jobs/claim` 응답에 `audio_llm_enabled`가 실려 오며 워커는 이 값을 따른다. 워커에 키가 없으면 켜져 있어도 건너뛴다.
- 신규 신청과 작업 등록은 같은 트랜잭션이며 기존 신청은 마이그레이션에서 등록한다. AI 필터 OFF·거절 곡도 포함한다. Spotify는 `unsupported`로 등록하며 claim하지 않는다.
- 완료 응답 유실 시 같은 lease로 재전송하면 기존 결과를 반환한다. 만료 lease로 바로 완료하면 409다. resume은 같은 토큰을 유지하고 다른 워커가 인계받지 않은 작업만 재개한다. 교체되거나 관리자 재큐잉으로 폐기한 토큰은 409다. 완료되지 않은 lease는 만료 후 다음 claim에서 회수한다.
- 실패 코드와 분류의 단일 기준은 `server/src/constants/audio-pipeline.json`이다. 인프라 오류는 짧은 대기, 일시 다운로드 오류는 초기 지수 지연 후 장기 재시도, 영구 소스 오류는 중단이다. 분석 실패·lease 소진은 횟수 제한 후 failed이며 관리자 재시도가 가능하다. 플랫폼 원문 오류·토큰·음원은 보내지 않는다.
- 자동 라벨은 `evaluation`으로 저장하며 원본은 분석 행의 `automatic_annotation`, 최종 라벨은 `music_track_annotations`에 남긴다. 사람 확인·수정 후에는 자동 갱신이 최종 라벨을 덮어쓰지 않는다.
- 검토 body: `{ annotation_revision, audio_analysis_id, audio_analysis_revision, track_annotation?, artist_confirmed?, reviewed_fields? }`. `track_annotation` 생략은 그대로 확인, 포함은 수정 저장이다. 화면에서 본 분석 ID·revision과 최종 라벨 revision을 잠금 안에서 비교하고 변경됐으면 409로 전체 롤백한다. 자동 라벨이 없으면 단순 확인은 409다.
- 검토 완료는 최종 라벨의 `human_review_status`가 `confirmed|corrected`이고 연결된 분석이 없거나 `reviewed`일 때다. 매장 정책 골드 판단과 무관하다. 저장 후 서버 집계를 다시 조회한다.
- 기존 정책 검수 API에서 `audio_analysis_id`를 보낼 경우에도 `audio_analysis_revision`이 필요하다. 분석 없이 정책 판단만 저장하는 기존 요청은 유지한다.

`ready`는 자동 라벨 저장이 끝났고 사람 검토가 남은 곡만 보여준다. Lab 기본 보기이며 대기·실패·Spotify 상태는 미검토 전체/전체 보기에서 확인한다.

MAEST 완료 요청은 `maest_run`에 schema_version=1, pipeline_mode(`MAEST_ONLY`·`MAEST_EMOTION`·`FULL`), sources_used, maest_model_version, model_sha256, audio_source_url, audio_local_path=null, audio_sha256, audio_duration_sec, audio_sample_rate=16000, maest_raw, audio_llm_raw, normalized를 포함한다. maest_raw는 519개 classes/mean/max, 최대 64개 segments(start_sec/end_sec/scores), settings, essentia_version이다. 집계와 구간 점수 일치·마지막 구간 포함을 검증한다. normalized에는 taxonomy_version, calibrated=false, genre(label/source/raw_label/confidence), mood를 보낸다. MAEST_ONLY의 mood는 null이고 감정 모델 실행 시 valence·arousal·source·tags를 features와 일치시킨다. FULL은 입력 해시·모델·구간·서술을 포함한 audio_llm_raw를 보존하며 다른 모드는 null이다. 원본·자동 라벨·최신 분석·작업 완료는 같은 트랜잭션이다.

`essentia-maest` 모델은 원본이 필수다. 이전 MSD 워커 제출 형식은 이행 기간에 허용한다. MAEST 작업 경로만 워커 인증 후 1MB JSON을 허용하며 나머지 API의 64KB 제한은 유지한다. 목록의 maest_summary에는 상위 평균/최댓값, 구간 수, 매핑 정보, 입력 해시를 포함하고 전체 구간 원본은 별도 조회한다. 원본 보존은 이 마이그레이션 이후 MAEST 실행부터 적용되며 과거 덮어쓴 분석을 복원하지 않는다.

MAEST의 모델명·해시·설정·클래스 순서는 공통 계약과 정확히 일치해야 한다. 서버가 원본 점수에서 정규화 장르를 재계산해 워커의 normalized와 자동 라벨을 검증한다. MAEST tag_scores는 생략 가능하며 서버가 생성한다. 제출했다면 전체 원본 평균과 일치해야 한다. 기존 `/audio-analysis/results`로 MAEST 최신 행을 덮어쓰는 제출은 400이다.

목록에는 generation·attempts·available_at이 포함된다. 재큐잉은 generation을 올리고 이전 lease를 폐기하며 최종 사람 라벨을 보존한다. 재정규화 결과가 이미 동일하면 unchanged=true로 revision을 올리지 않는다. 변경되면 최신 분석 revision을 올리고 검토를 다시 대기시키며, 자동 최종 라벨만 갱신한다. 기존 원본 이력은 변경하지 않는다.

빠른 확인의 기본 reviewed_fields는 값이 알려진 장르·템포·리듬이다. 수정 저장은 값이 바뀐 필드를 확인 범위로 추가한다. unknown/빈 배열 필드는 정답 확인 범위에서 제외한다. artist_confirmed는 별도 명시적 boolean이며 이름 변경 시 생략하면 확인을 해제한다. 확인된 아티스트 참고 검색은 human 라벨 중 artist_confirmed=true만 사용한다. 마이그레이션 전 확인 범위는 추정하지 않는다.
