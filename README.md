# ☕ Caffeine Flow v2

> 카페 음악 추천 커뮤니티 플랫폼 — 손님이 QR코드로 음악을 추천하고, 사장님이 직접 재생을 결정합니다.

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
  추천/투표/코멘트          PostgreSQL (Supabase)
```

---

## 프로젝트 구조

```
caffeine-flow/
├── server/                  # Node.js + Express + Socket.IO (v2)
│   ├── server.js
│   └── src/
│       ├── config.js
│       ├── db/
│       │   ├── knex.js
│       │   ├── knexfile.js
│       │   └── migrations/
│       │       └── 001_initial.js
│       ├── middleware/
│       │   └── auth.js          # JWT 검증
│       ├── routes/
│       │   ├── auth.js          # 회원가입/로그인/저작권 동의
│       │   ├── cafes.js         # 카페 관리 + 통계
│       │   ├── recommendations.js
│       │   └── youtube.js       # oEmbed + 검색
│       ├── services/
│       │   ├── cafe.service.js
│       │   ├── recommendation.service.js
│       │   └── stats.service.js
│       └── socket/
│           └── index.js         # /cafe 네임스페이스
│
├── customer/                # 손님 React 앱 (Vite)
│   └── src/
│       ├── App.jsx          # /:slug 라우팅
│       ├── api.js
│       ├── socket.js
│       └── pages/
│           ├── CafePage.jsx
│           ├── NowPlaying.jsx
│           ├── RecommendForm.jsx
│           └── SongCard.jsx
│
├── owner/                   # 사장님 React 앱 (Vite)
│   └── src/
│       ├── App.jsx          # 로그인 → 저작권 → 대시보드
│       ├── api.js
│       ├── socket.js
│       └── pages/
│           ├── LoginPage.jsx
│           ├── DisclaimerPage.jsx
│           ├── DashboardPage.jsx
│           ├── RecommendCard.jsx
│           └── StatsPanel.jsx
│
├── server.js                # v1 레거시 서버 (유지)
└── src/                     # v1 레거시 소스 (유지)
```

---

## DB 스키마

| 테이블 | 설명 |
|--------|------|
| `cafes` | 카페 (멀티테넌시 루트) |
| `recommendations` | 추천곡 큐 + 이력 통합 |
| `votes` | IP당 1회 투표 |
| `comments` | 한줄 코멘트 |
| `daily_stats` | 일별 집계 |

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
| GET | `/api/v1/cafes/:slug/recommendations` | 오늘 추천 목록 |
| POST | `/api/v1/cafes/:slug/recommendations` | 곡 추천 (손님) |
| PUT | `/api/v1/cafes/:slug/recommendations/:id` | 상태 변경 (사장님) |
| POST | `/api/v1/cafes/:slug/recommendations/:id/vote` | 투표 |
| POST | `/api/v1/cafes/:slug/recommendations/:id/comments` | 코멘트 |
| GET | `/api/v1/youtube/oembed` | 영상 정보 조회 |
| GET | `/api/v1/youtube/search` | 유튜브 검색 |
| GET | `/api/v1/cafes/me/stats` | 전체 통계 |

---

## 시작하기

### 사전 준비
- Node.js 18+
- Supabase 프로젝트 (PostgreSQL)
- YouTube Data API v3 키 (검색 기능 사용 시)

### 환경 변수 설정

루트의 `.env` 파일:

```env
PORT=3000
YOUTUBE_API_KEY=your-youtube-api-key

DATABASE_URL=postgresql://postgres:[비밀번호]@[host]/postgres
JWT_SECRET=your-jwt-secret
```

### DB 마이그레이션

```bash
cd server
npm install
npm run migrate
```

### 서버 실행

```bash
# 터미널 1 — 서버
cd server && npm run dev

# 터미널 2 — 손님 앱
cd customer && npm install && npm run dev

# 터미널 3 — 사장님 앱
cd owner && npm install && npm run dev
```

| 앱 | URL |
|----|-----|
| 서버 | http://localhost:3000 |
| 손님 | http://localhost:5173/:slug |
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
| 프론트 | React, Vite |
| 인증 | JWT (사장님) / IP 기반 (손님) |
| 배포 | Railway (서버) + Supabase (DB) |
