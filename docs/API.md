# API 레퍼런스

Base URL은 `/api/v1`이고 모든 응답은 JSON이다. 인증이 필요한 엔드포인트는 `Authorization: Bearer <JWT>` 헤더를 요구한다.

> **코드가 진실이다.** 이 표는 어떤 엔드포인트가 어디 있는지 찾기 위한 인덱스이고, 정확한 동작·한도 수치는 `server/src/routes/`가 기준이다. 라우트를 추가·변경하면 이 표도 함께 갱신한다.

범례: 🔓 공개 · 🔒 사장님 인증(requireAuth) · 🏪 카페 소유자(requireCafeOwner) · ⏱ rate limited

---

## 인증 — `/auth`

| Method | Path | 인증 | 설명 |
| --- | --- | :-: | --- |
| POST | `/auth/google` | 🔓 | Google idToken 로그인. body에 `cafeName`+`agreed`면 신규 가입 |
| GET | `/auth/naver` | 🔓 | Naver OAuth 시작 (state 쿠키 발급 후 리다이렉트) |
| GET | `/auth/naver/callback` | 🔓 | Naver 콜백 → 토큰을 **URL fragment**로 담아 앱으로 리다이렉트 |
| POST | `/auth/complete` | 🔓 | pending 토큰으로 신규 가입 완료 (Google·Naver 공통) |

로그인 응답: `{ token, cafe }`. 신규 회원: `{ needsSetup: true, pendingToken }`. 같은 이메일의 타 provider 계정이 있으면 응답에 `emailWarning` 힌트 포함.

---

## 카페 관리 — `/cafes`

모두 사장님 인증(🔒)이 필요하다. JWT에 담긴 slug로 대상 카페를 식별한다.

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/cafes/me` | 내 카페 정보 |
| PUT | `/cafes/me` | 카페명 등 기본 정보 |
| PUT | `/cafes/me/notice` | 공지 |
| PUT | `/cafes/me/platforms` | 허용 플랫폼 (youtube/soundcloud/spotify) |
| PUT | `/cafes/me/marketing` | 마케팅 수신 동의 |
| PUT | `/cafes/me/address` | 주소·좌표 |
| PUT | `/cafes/me/status` | 신청 ON/OFF |
| GET | `/cafes/me/history` | 재생 이력 (`?date=` KST 기준 필터) |
| GET | `/cafes/me/stats` | 종합 통계 + TOP10 |
| GET | `/cafes/me/stats/daily` | 일별 (`?date=`) |
| GET | `/cafes/me/stats/hourly` | 시간대별 패턴 (최근 30일) |
| GET | `/cafes/me/stats/weekday` | 요일별 패턴 (최근 30일) |
| GET | `/cafes/me/stats/hourly-songs` | 특정 시간대 신청곡 (`?hour=`) |
| GET | `/cafes/me/stats/weekday-songs` | 특정 요일 신청곡 (`?day=`) |

---

## 추천곡 — `/cafes/:slug/recommendations`

owner 라우터가 public보다 먼저 마운트된다(인증 핸들러가 경로 매칭을 먼저 가져가도록 하기 위해서다).

### 공개 (손님)
| Method | Path | 인증 | 설명 |
| --- | --- | :-: | --- |
| GET | `/` | 🔓 | 큐 조회 (+ 방문 기록, KST 하루 1회) |
| POST | `/` | 🔓 ⏱ | 신청. 중복 409, 큐 초과 429 |
| GET | `/top10` | 🔓 | 매장 TOP10 (`?offset=`) |
| DELETE | `/:id/cancel` | 🔓 | 본인 신청 취소 — visitor_id/IP 일치 필요, 불일치 403 |
| POST | `/:id/vote` | 🔓 ⏱ | 투표. 중복 409 |
| DELETE | `/:id/vote` | 🔓 ⏱ | 투표 취소 |
| POST | `/:id/comments` | 🔓 ⏱ | 댓글 |

### 사장님 (🏪 requireAuth + requireCafeOwner)
| Method | Path | 설명 |
| --- | --- | --- |
| POST | `/owner` | 사장님 직접 신청 |
| PUT | `/:id` | 상태 변경 (accept/skip/play 등). 종료 상태 역전이 409 |
| DELETE | `/:id` | 삭제 |

---

## 곡 댓글 — `/songs/:videoId/comments`

카페와 상관없이 video_id를 기준으로 묶이는 곡별 댓글이다. `/cafes/:slug/songs/:videoId/comments` 경로로도 접근할 수 있다.

| Method | Path | 인증 | 설명 |
| --- | --- | :-: | --- |
| GET | `/` | 🔓 | 곡 댓글 목록 |
| POST | `/` | 🔓 ⏱ | 댓글 작성 |
| POST | `/:commentId/replies` | 🔓 ⏱ | 답글 |

---

## 트랙 메타데이터 — `/tracks`

| Method | Path | 인증 | 설명 |
| --- | --- | :-: | --- |
| GET | `/tracks/oembed?url=` | 🔓 | YouTube/SoundCloud/Spotify URL → `{ platform, videoId, title, channelTitle, thumbnail }`. 사용자 URL fetch는 SSRF 방어(safeAxiosGet) 경유 |

---

## 통합 TOP10 — `/top10`

| Method | Path | 인증 | 설명 |
| --- | --- | :-: | --- |
| GET | `/api/v1/top10?offset=` | 🔓 | 전체 카페 통합 TOP10 |

---

## 헬스체크

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/health` | `{ status: 'ok', version: 'v2' }` |

---

## 공통 에러

| 코드 | 의미 |
| --- | --- |
| 400 | 입력 검증 실패 |
| 401 | 토큰 없음·만료 |
| 403 | 권한 없음 (타 카페 / 타인 신청 취소) |
| 409 | 중복 (신청·투표) 또는 잘못된 상태 전이 |
| 429 | rate limit 초과 (큐 만석 포함) |
| 500 | 서버 오류 |
