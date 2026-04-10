# ☕ Caffeine Flow v2

> 카페 음악 추천 커뮤니티 플랫폼 — 손님이 QR코드로 음악을 신청하고, 사장님이 직접 재생을 결정합니다.

---

## 개요

| 구분 | v1 (레거시) | v2 (현재) |
|------|------------|----------|
| 구조 | 단일 카페, 파일 저장 | 멀티테넌시, PostgreSQL |
| 재생 | 자동 재생 | 사장님이 직접 결정 |
| 프론트엔드 | Vanilla JS | React (Vite) + Electron |
| 인증 | 토큰 1개 | Google/Naver OAuth (사장님) |

---

## 아키텍처

```
손님 (React Web)          중앙 서버 (Node.js)         사장님 (Electron + React)
  customer/ :5173   ◄──► server/ :3000            ◄──► owner/ :5174
  QR → /:slug             Express + Socket.IO            YouTube BrowserView
  추천/투표/댓글           PostgreSQL (Supabase)          실시간 재생 제어
```

---

## 프로젝트 구조

```
caffeine-flow/
├── server/                  # Node.js + Express + Socket.IO (v2)
│   ├── server.js
│   └── src/
│       ├── db/
│       │   └── migrations/
│       │       ├── 001_initial.js
│       │       ├── 002_song_comments.js
│       │       ├── 003_song_comments_replies.js
│       │       ├── 004_oauth.js
│       │       ├── 005_cafe_notice.js
│       │       └── 006_tracking.js
│       ├── routes/
│       │   ├── auth.js              # Google/Naver OAuth
│       │   ├── cafes.js             # 카페 관리 + 통계
│       │   ├── recommendations.js   # + POST /owner (사장님 직접 추가)
│       │   ├── song_comments.js     # TOP 항목 댓글/대댓글
│       │   └── youtube.js
│       └── services/
│           ├── cafe.service.js
│           ├── recommendation.service.js
│           ├── song_comments.service.js
│           └── stats.service.js
│
├── customer/                # 손님 React 앱 (Vite)
│   └── src/
│       ├── App.jsx
│       ├── api.js
│       ├── socket.js
│       ├── deviceName.js    # 기기 닉네임 (localStorage)
│       ├── votedSongs.js    # 투표 이력 (localStorage)
│       └── pages/
│           ├── CafePage.jsx
│           ├── NowPlaying.jsx
│           ├── RecommendForm.jsx
│           └── SongCard.jsx
│
├── owner/                   # 사장님 Electron + React 앱 (Vite)
│   ├── electron/
│   │   ├── main.js              # BrowserWindow + YouTube BrowserView
│   │   ├── preload.js           # contextBridge IPC API
│   │   └── youtube-preload.js   # YouTube 영상 종료 감지
│   └── src/
│       ├── App.jsx
│       ├── api.js
│       ├── socket.js
│       └── pages/
│           ├── LoginPage.jsx        # Google/Naver OAuth 로그인
│           ├── DashboardPage.jsx    # 4섹션 큐 관리 + 드래그앤드롭
│           ├── RecommendCard.jsx
│           └── StatsPanel.jsx
│
├── server.js                # v1 레거시 서버
└── src/                     # v1 레거시 소스
```

---

## DB 스키마

| 테이블 | 설명 |
|--------|------|
| `cafes` | 카페 (google_id, naver_id, notice, last_login_at 포함) |
| `recommendations` | 신청곡 큐 + 이력 통합 |
| `votes` | IP당 1회 투표 (취소 가능) |
| `song_comments` | TOP 항목 댓글/대댓글 (video_id 기준, 전 카페 공유) |
| `cafe_visits` | 손님 방문 기록 (IP 기준, 하루 1회) |
| `daily_stats` | 일별 집계 (스키마 예약) |

추천곡 상태 흐름: `pending → accepted → playing → played`  
거절/스킵: `pending/accepted → rejected/skipped`

---

## API

### 인증
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/v1/auth/google` | Google OAuth 로그인/가입 |
| GET | `/api/v1/auth/naver` | Naver OAuth 시작 |
| GET | `/api/v1/auth/naver/callback` | Naver OAuth 콜백 |
| POST | `/api/v1/auth/complete` | 신규 가입 완료 (카페명 + 약관) |

### 카페 (사장님)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/v1/cafes/me` | 내 카페 정보 |
| PUT | `/api/v1/cafes/me` | 카페 이름 변경 |
| PUT | `/api/v1/cafes/me/status` | 신청 ON/OFF |
| PUT | `/api/v1/cafes/me/notice` | 공지사항 설정 |
| GET | `/api/v1/cafes/me/stats` | 누적 통계 |
| GET | `/api/v1/cafes/me/stats/daily` | 일별 통계 |
| GET | `/api/v1/cafes/me/stats/hourly` | 시간대별 패턴 (최근 30일) |
| GET | `/api/v1/cafes/me/stats/weekday` | 요일별 패턴 (최근 30일) |
| GET | `/api/v1/cafes/me/stats/weekday-songs` | 요일별 신청곡 목록 |

### 신청곡
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/v1/cafes/:slug/recommendations` | 최근 7일 목록 + 공지 + 카페명 |
| POST | `/api/v1/cafes/:slug/recommendations` | 곡 신청 (손님, 중복 방지) |
| POST | `/api/v1/cafes/:slug/recommendations/owner` | 곡 직접 추가 (사장님) |
| DELETE | `/api/v1/cafes/:slug/recommendations/:id/cancel` | 내 신청 취소 (손님) |
| PUT | `/api/v1/cafes/:slug/recommendations/:id` | 상태 변경 (사장님) |
| POST | `/api/v1/cafes/:slug/recommendations/:id/vote` | 투표 |
| DELETE | `/api/v1/cafes/:slug/recommendations/:id/vote` | 투표 취소 |
| GET | `/api/v1/cafes/:slug/recommendations/top10` | 카페 TOP 10 |
| GET | `/api/v1/top10` | 전체 카페 통합 TOP 30 |

### 댓글
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/POST | `/api/v1/songs/:videoId/comments` | TOP 댓글 (전체 공유) |
| POST | `/api/v1/songs/:videoId/comments/:id/replies` | 대댓글 |

---

## 손님 기능

| 기능 | 설명 |
|------|------|
| 카페 이름 + 공지 표시 | 페이지 상단에 실시간 표시 |
| 지금 재생 중 | 재생 중인 곡 상단 노출 |
| 곡 신청 | YouTube URL → 미리보기 → 신청 (중복 차단) |
| 내 신청 취소 | 대기 중인 내 신청곡 직접 취소 |
| 신청 순번 안내 | 신청 완료 시 "n번째로 대기 중" 표시 |
| 신청곡 큐 | 투표순 정렬, 순서 번호, 내 신청곡 강조 |
| 수락 뱃지 | 사장님이 수락한 곡에 "✅ 사장님이 수락했어요" 표시 |
| 투표 토글 | 👍 추천/취소 (기기별 1회, localStorage 기반) |
| 최근 7일 이력 | 재생/스킵/거절 이력 + 날짜 |
| 이 카페 TOP 10 | 카페 인기곡 (신청순/추천순 정렬) |
| 전체 TOP 30 | 전체 카페 통합 인기곡 (카페명 표시) |
| 댓글 & 대댓글 | TOP 항목별 YouTube 스타일 댓글 |
| 기기 닉네임 | 자동 생성 (한국 카페 감성), localStorage 영구 저장 |

---

## 사장님 기능

| 기능 | 설명 |
|------|------|
| Google/Naver OAuth 로그인 | 소셜 로그인, 최초 가입 시 약관 동의 |
| YouTube 패널 (Electron) | 앱 우측에 YouTube BrowserView 내장, 로그인 시 자동 표시 |
| 기본 재생 곡 | 추천곡이 없을 때 반복 재생할 기본 영상 설정 (YouTube URL) |
| 4섹션 큐 관리 | 기본 / 추천 재생 중 / 대기 곡 / 추천 곡 섹션으로 분리 |
| 드래그앤드롭 | 섹션 간 곡 이동 (재생 중 교체, 대기열 조정) |
| 자동 큐 진행 | 재생 곡 종료 시 대기 곡 → 추천 곡 순으로 자동 재생 |
| 카페 이름 변경 | 헤더에서 인라인 편집 |
| 공지사항 설정 | 실시간으로 손님 화면에 반영 |
| 신청 ON/OFF | 손님 신청 수락 여부 토글 |
| 통계 탭 | 오늘 요약, 시간대별·요일별 패턴 (클릭 시 곡 목록) |
| QR 코드 | 손님 접속 QR 생성 및 다운로드 |

---

## Electron IPC

| 채널 | 방향 | 설명 |
|------|------|------|
| `show-youtube` / `hide-youtube` | React → Main | YouTube 패널 표시/숨김 |
| `play-video` | React → Main | 특정 영상 재생 |
| `stop-video` | React → Main | 재생 중지 (기본 재생 곡으로 복귀) |
| `set-default-video` / `clear-default-video` | React → Main | 기본 재생 곡 설정/해제 |
| `video-ended` | Main → React | 영상 종료 감지 → 다음 곡 재생 |
| `now-playing` | Main → React | 현재 재생 영상 정보 (videoId, title, thumbnail) |
| `default-playing` | Main → React | 기본 재생 곡 활성 여부 |
| `queue-restore` | Main → React | 큐 재생 완료 후 복귀 URL |

---

## 시작하기

### 환경 변수 설정

루트 `.env` (`.env.example` 참고):

```env
PORT=3000
DATABASE_URL=postgresql://...
JWT_SECRET=your-jwt-secret
GOOGLE_CLIENT_ID=...
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...
APP_URL=http://localhost:5174
SERVER_URL=http://localhost:5174
```

`owner/.env`:
```env
VITE_GOOGLE_CLIENT_ID=...
VITE_NAVER_ENABLED=true   # 네이버 준비 완료 시
```

### DB 마이그레이션

```bash
cd server
npm install
npm run migrate
```

### 실행

```bash
# 터미널 1 — 서버 (시작 시 카페별 QR코드 출력)
cd server && npm run dev

# 터미널 2 — 사장님 앱 (Electron + React)
cd owner && npm install && npm run electron:dev

# 터미널 3 — 손님 앱 개발 서버 (선택)
cd customer && npm install && npm run dev
```

### 모바일 테스트 (빌드 후 QR 접속)

```bash
cd customer && npm run build   # server/public/ 에 빌드
cd server && npm run dev       # 터미널에 카페별 QR 출력
```

| 앱 | URL |
|----|-----|
| 서버 | http://localhost:3000 |
| 손님 (개발) | http://localhost:5173/:slug |
| 손님 (빌드) | http://서버IP:3000/:slug |
| 사장님 | Electron 앱 (http://localhost:5174 개발 시) |

---

## 구현 현황

- [x] Phase 0 — 프로젝트 구조 + DB 마이그레이션
- [x] Phase 1 — 서버 멀티테넌시 (REST API, Socket.IO)
- [x] Phase 2 — 손님 React 앱
- [x] Phase 3 — 사장님 React 앱 (OAuth, 통계, 공지, QR)
- [x] Phase 4 — Electron 래퍼 (YouTube BrowserView, IPC, 큐 자동 진행)
- [ ] Phase 5 — 크로스 카페 트렌드 / 플랫폼 어드민

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 서버 | Node.js, Express, Socket.IO, Knex.js |
| DB | PostgreSQL (Supabase) |
| 프론트 | React 18, Vite |
| 데스크탑 | Electron (사장님 앱) |
| 인증 | Google OAuth 2.0, Naver OAuth 2.0 |
| 배포 | Railway (서버) + Supabase (DB) |
