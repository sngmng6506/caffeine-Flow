# ☕ Caffeine Flow v2

> 카페 음악 추천 커뮤니티 플랫폼 — 손님이 QR코드로 음악을 신청하고, 사장님이 직접 재생을 결정합니다.

---

## 개요

| 구분 | v1 (레거시) | v2 (현재) |
|------|------------|----------|
| 구조 | 단일 카페, 파일 저장 | 멀티테넌시, PostgreSQL |
| 재생 | 자동 재생 | 사장님이 직접 결정 |
| 프론트엔드 | Vanilla JS | React (Vite) |
| 인증 | 토큰 1개 | JWT (사장님) / IP (손님) |

---

## 아키텍처

```
손님 (React Web)          중앙 서버 (Node.js)         사장님 (React Web)
  customer/ :5173   ◄──► server/ :3000            ◄──► owner/ :5174
  QR → /:slug             Express + Socket.IO
  추천/투표/댓글           PostgreSQL (Supabase)
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
│       │       └── 003_song_comments_replies.js
│       ├── routes/
│       │   ├── auth.js
│       │   ├── cafes.js
│       │   ├── recommendations.js
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
├── owner/                   # 사장님 React 앱 (Vite)
│
├── server.js                # v1 레거시 서버
└── src/                     # v1 레거시 소스
```

---

## DB 스키마

| 테이블 | 설명 |
|--------|------|
| `cafes` | 카페 (멀티테넌시 루트) |
| `recommendations` | 신청곡 큐 + 이력 통합 |
| `votes` | IP당 1회 투표 |
| `song_comments` | TOP 항목 댓글/대댓글 (video_id 기준, 전 카페 공유) |
| `daily_stats` | 일별 집계 (스키마 예약, 미사용) |

추천곡 상태 흐름: `pending → accepted → playing → played`  
거절/스킵: `pending/accepted → rejected/skipped`

---

## API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/v1/auth/register` | 카페 등록 |
| POST | `/api/v1/auth/login` | 로그인 (JWT 발급) |
| POST | `/api/v1/auth/disclaimer` | 저작권 동의 |
| GET | `/api/v1/cafes/me` | 내 카페 정보 |
| PUT | `/api/v1/cafes/me/status` | 신청 ON/OFF |
| GET | `/api/v1/cafes/:slug/recommendations` | 최근 7일 추천 목록 |
| POST | `/api/v1/cafes/:slug/recommendations` | 곡 신청 (손님) |
| PUT | `/api/v1/cafes/:slug/recommendations/:id` | 상태 변경 (사장님) |
| POST | `/api/v1/cafes/:slug/recommendations/:id/vote` | 추천 투표 |
| GET | `/api/v1/cafes/:slug/recommendations/top10` | 카페 TOP 10 |
| GET | `/api/v1/top10` | 전체 카페 통합 TOP 30 |
| GET/POST | `/api/v1/cafes/:slug/songs/:videoId/comments` | 카페 TOP 댓글 |
| GET/POST | `/api/v1/songs/:videoId/comments` | 전체 TOP 댓글 |
| POST | `/api/v1/songs/:videoId/comments/:id/replies` | 대댓글 |
| GET | `/api/v1/youtube/oembed` | 영상 정보 조회 |
| GET | `/api/v1/cafes/me/stats` | 전체 통계 |

---

## 손님 기능

| 기능 | 설명 |
|------|------|
| 곡 신청 | YouTube URL 붙여넣기 → 미리보기 → 신청 |
| 신청 순번 | 신청 완료 시 "n번째로 대기 중" 안내 |
| 신청곡 큐 | 순서 번호 표시, 내가 신청한 곡 강조 |
| 투표 | 👍 추천 (기기별 1회, 중복 방지 UI) |
| 최근 7일 이력 | 재생/스킵/거절 이력 + 날짜 |
| 이 카페 TOP 10 | 카페 인기곡 (신청순/추천순 정렬) |
| 전체 TOP 30 | 전체 카페 통합 인기곡 (카페명 표시) |
| 댓글 & 대댓글 | TOP 항목별 YouTube 스타일 댓글 |
| 기기 닉네임 | 자동 생성, localStorage 영구 저장 |

---

## 시작하기

### 환경 변수 설정

루트 `.env`:

```env
PORT=3000
DATABASE_URL=postgresql://postgres:[비밀번호]@[host]/postgres
JWT_SECRET=your-jwt-secret
YOUTUBE_API_KEY=   # 선택사항 (검색 기능 사용 시)
```

### DB 마이그레이션

```bash
cd server
npm install
npm run migrate
```

### 서버 실행

```bash
# 터미널 1 — 서버 (시작 시 카페별 QR코드 출력)
cd server && npm run dev

# 터미널 2 — 손님 앱 (개발)
cd customer && npm install && npm run dev

# 터미널 3 — 사장님 앱
cd owner && npm install && npm run dev
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
| 사장님 | http://localhost:5174 |

---

## 구현 현황

- [x] Phase 0 — 프로젝트 구조 + DB 마이그레이션
- [x] Phase 1 — 서버 멀티테넌시 (JWT 인증, REST API, Socket.IO)
- [x] Phase 2 — 손님 React 앱
- [x] Phase 3 — 사장님 React 앱
- [ ] Phase 4 — Electron 래퍼 (YouTube WebView)
- [ ] Phase 5 — 크로스 카페 트렌드

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 서버 | Node.js, Express, Socket.IO, Knex.js |
| DB | PostgreSQL (Supabase) |
| 프론트 | React 18, Vite |
| 인증 | JWT (사장님) / IP + localStorage (손님) |
| 배포 | Railway (서버) + Supabase (DB) |
