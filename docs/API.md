# API 레퍼런스

> **AI가 읽을 때:** HTTP 경로, 메서드, 인증, 요청·응답, 상태 코드를 추가하거나 변경할 때
> **함께 갱신할 때:** 클라이언트가 의존하는 외부 API 계약이 달라질 때
> **생략 가능한 경우:** 라우트의 외부 동작을 유지한 채 서비스·쿼리 내부만 리팩터링할 때

Base URL은 `/api/v1`이며 응답은 JSON이다. 인증 엔드포인트는 `Authorization: Bearer <JWT>`를 사용한다.

범례: 🔓 공개 · 🔒 사장님 인증 · 🏪 카페 소유자 확인 · 🛡 운영자 · ⏱ 요청 제한

이 문서는 현재 경로와 입출력 요약만 다룬다. 상태 흐름은 [ARCHITECTURE.md](ARCHITECTURE.md), AI 판단은 [LLM_FILTER.md](LLM_FILTER.md), 변경 계약은 [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md)를 참고한다.

## 인증 — `/auth`

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| POST | `/auth/google` | 🔓 | Google idToken 로그인. 신규 회원은 `pendingToken` 반환 |
| GET | `/auth/naver` | 🔓 | Naver OAuth 시작 |
| GET | `/auth/naver/callback` | 🔓 | OAuth 콜백 후 앱으로 이동 |
| POST | `/auth/complete` | 🔓 | pending token으로 신규 가입 완료 |

기존 회원 응답은 `{ token, cafe }`, 신규 회원은 `{ needsSetup: true, pendingToken }` 형태다.

## 카페 관리 — `/cafes`

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/cafes/me` | 🔒 | 내 카페 정보 |
| PUT | `/cafes/me` | 🔒 | 카페명 등 기본 정보 변경 |
| PUT | `/cafes/me/notice` | 🔒 | 손님 공지 변경 |
| PUT | `/cafes/me/platforms` | 🔒 | 허용 플랫폼 변경 |
| PUT | `/cafes/me/music-filter` | 🔒 | AI 음악 필터 사용 여부·매장 분위기 설명 설정 |
| POST | `/cafes/me/music-filter/test` | 🔒 | 현재 매장 분위기 설명으로 저장 없이 곡 판단 미리보기 |
| PUT | `/cafes/me/address` | 🔒 | 지역·좌표 변경 |
| PUT | `/cafes/me/slug` | 🔒 | QR slug 재발급·지정. 새 `token` 포함 |
| PUT | `/cafes/me/status` | 🔒 | 신청 접수 ON/OFF |
| GET | `/cafes/me/history` | 🔒 | 재생 이력. 처리 최신순, `?date=`는 신청일의 KST 기준 |
| GET | `/cafes/me/stats` | 🔒 | 종합 통계와 TOP10 |
| GET | `/cafes/me/stats/music-filter` | 🔒 | 최근 AI 필터 처리 현황 |
| GET | `/cafes/me/stats/daily` | 🔒 | 일별 통계 `?date=` |
| GET | `/cafes/me/stats/hourly` | 🔒 | 시간대별 패턴 |
| GET | `/cafes/me/stats/weekday` | 🔒 | 요일별 패턴 |
| GET | `/cafes/me/stats/hourly-songs` | 🔒 | 특정 시간대 곡 `?hour=` |
| GET | `/cafes/me/stats/weekday-songs` | 🔒 | 특정 요일 곡 `?day=` |

`GET /cafes/me`는 최초 가입 시 할당된 QR slug를 `initial_slug`로 반환한다.
`PUT /cafes/me/slug` 응답에도 `initial_slug`와 새 JWT가 포함되며, 클라이언트는 JWT를 즉시 교체해야 한다.

## 추천곡 — `/cafes/:slug/recommendations`

### 손님

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/` | 🔓 | 활성 큐 조회와 방문 기록 |
| POST | `/` | 🔓 ⏱ | 신청곡 등록. 중복·큐 한도·AI 필터 적용 |
| GET | `/top10` | 🔓 | 매장 TOP10 `?offset=` |
| DELETE | `/:id/cancel` | 🔓 | 본인 신청 취소 |
| POST | `/:id/vote` | 🔓 ⏱ | 투표 |
| DELETE | `/:id/vote` | 🔓 ⏱ | 투표 취소 |
| POST | `/:id/comments` | 🔓 ⏱ | 신청곡 댓글 |

### 사장님

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| POST | `/owner` | 🏪 | 사장님 직접 신청. AI 필터 우회 |
| PUT | `/:id` | 🏪 | 상태 변경 |
| DELETE | `/:id` | 🏪 | 신청곡 삭제 |

사장님 라우터가 public 라우터보다 먼저 마운트되어야 한다.

`/:id`를 사용하는 모든 추천곡 mutation은 URL의 `:slug`가 가리키는 카페 범위에서만 해당 recommendation을 조회·수정한다. 다른 카페의 recommendation ID를 전달하면 리소스 존재 여부와 무관하게 404로 처리한다.

## 곡 댓글 — `/songs/:videoId/comments`

`/cafes/:slug/songs/:videoId/comments` 경로에서도 같은 곡 댓글에 접근한다.
카페 경로는 활성 카페만 허용하며 잘못된 slug는 404다. 답글의
`:commentId`는 URL의 `:videoId`에 속한 최상위 댓글이어야 한다.

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/` | 🔓 | 댓글 목록 |
| POST | `/` | 🔓 ⏱ | 댓글 작성 |
| POST | `/:commentId/replies` | 🔓 ⏱ | 답글 작성 |

## 트랙 메타데이터 — `/tracks`

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/tracks/oembed?url=` | 🔓 | 음악 URL을 공통 트랙 메타데이터로 변환 |

사용자 URL 요청은 `safeAxiosGet`을 거쳐 SSRF를 방어한다.

## 운영자 — `/admin`

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| POST | `/admin/login` | 🔓 | 운영자 로그인, 12시간 토큰. 로그인 횟수 제한은 임시 비활성 |
| GET | `/admin/cafes` | 🛡 | 전체 카페와 운영 상태 조회 |
| PUT | `/admin/cafes/:id/suspend` | 🛡 | 카페 정지·해제 |
| DELETE | `/admin/cafes/:id` | 🛡 | 카페와 종속 데이터 삭제 |

잘못된 UUID와 미존재 카페는 404다. 정지 카페는 손님 HTTP와 Socket.IO 접근이 차단된다.

## 통합 TOP10

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/api/v1/top10?offset=` | 🔓 | 정지 카페를 제외한 전체 TOP10 |

## 헬스체크

| Method | Path | 인증 | 요약 |
| --- | --- | :-: | --- |
| GET | `/health` | 🔓 | 서버 상태와 버전 |

## 공통 상태 코드

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

정확한 body 필드와 응답 shape는 라우트 코드와 테스트가 최종 기준이다.
