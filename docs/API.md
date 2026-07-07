# API 레퍼런스

Base URL: `/api/v1`. 모든 응답은 JSON. 인증이 필요한 엔드포인트는 `Authorization: Bearer <JWT>` 헤더를 요구한다.

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

모두 사장님 인증(🔒). JWT의 slug로 대상 카페를 특정한다.

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

owner 라우터가 public보다 먼저 마운트된다 (인증 핸들러가 경로 매치를 먼저 가져가도록).

### 공개 (손님)
| Method | Path | 인증 | 설명 |
| --- | --- | :-: | --- |
| GET | `/` | 🔓 | 큐 조회 (+ 방문 기록, KST 하루 1회) |
| POST | `/` | 🔓 ⏱ | 신청. 중복 409, 큐 초과(30) 429. visitor 3/min + IP 10/min |
| GET | `/top10` | 🔓 | 매장 TOP10 (`?offset=`) |
| DELETE | `/:id/cancel` | 🔓 | 본인 신청 취소 — visitor_id/IP 일치 필요, 불일치 403 |
| POST | `/:id/vote` | 🔓 ⏱ | 투표. 중복 409. 15/min·IP 40/min |
| DELETE | `/:id/vote` | 🔓 ⏱ | 투표 취소 |
| POST | `/:id/comments` | 🔓 ⏱ | 댓글. 5/min·IP 15/min |

### 사장님 (🏪 requireAuth + requireCafeOwner)
| Method | Path | 설명 |
| --- | --- | --- |
| POST | `/owner` | 사장님 직접 신청 |
| PUT | `/:id` | 상태 변경 (accept/skip/play 등). 종료 상태 역전이 409 |
| DELETE | `/:id` | 삭제 |

---

## 곡 댓글 — `/songs/:videoId/comments`

카페 무관하게 video_id 기준으로 묶이는 곡별 댓글. `/cafes/:slug/songs/:videoId/comments`로도 접근 가능.

| Method | Path | 인증 | 설명 |
| --- | --- | :-: | --- |
| GET | `/` | 🔓 | 곡 댓글 목록 |
| POST | `/` | 🔓 ⏱ | 댓글 작성 (5/min·IP 15/min) |
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
