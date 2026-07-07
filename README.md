# Caffeine Flow

> 카페 손님이 QR로 음악을 신청하고, 사장님이 데스크톱에서 큐를 관리·재생하는 실시간 음악 추천 플랫폼.

YouTube · SoundCloud · Spotify 세 플랫폼을 한 화면에서 **매장 BGM(고정) + 신청곡(임시 오버레이)** 구조로 재생

| | |
| --- | --- |
| **손님** | QR 스캔 → 모바일 브라우저에서 링크 신청·투표·댓글 (앱 설치 없음) |
| **사장님** | Electron 데스크톱 앱에서 큐 관리 + 실제 재생, 또는 웹 대시보드 |
| **백엔드** | Express + Postgres, Socket.IO 실시간 큐, Railway 배포 |
| **재생** | BrowserView 2개 (BGM 고정 / 신청곡 오버레이), 곡 종료 자동 감지 |

## 기술 스택

React 18 · Vite 5 (손님·사장님 SPA) · Node.js · Express 4 · Knex 3 · Socket.IO 4 · PostgreSQL · Electron 41(CastLabs `wvcus`) · Google/Naver OAuth · Vitest/Supertest · Railway · GitHub Releases

## 빠른 시작

```bash
# 1) 의존성 설치
npm install && npm install --prefix server \
  && npm install --prefix customer && npm install --prefix owner

# 2) 루트에 .env 작성 (DATABASE_URL·JWT_SECRET 필수)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # JWT_SECRET 생성

# 3) DB 마이그레이션
npm run migrate --prefix server

# 4) 개발 서버 (각 터미널)
npm run dev:server     # localhost:3001
npm run dev:customer   # localhost:5173
npm run dev:owner      # localhost:5174

# 5) 사장님 데스크톱 개발 모드
cd owner && npm run electron:dev
```

## 프로젝트 구조

```
├── server/        Express + Postgres 백엔드 (배포 대상)
│   ├── app.js       Express 앱 조립 (라우트·미들웨어) — 테스트가 import
│   ├── server.js    HTTP·Socket.IO 리슨 (Railway 실행 엔트리)
│   └── src/         routes · services · middleware · socket · db · utils
├── customer/      손님 SPA (Vite + React)
├── owner/         사장님 SPA + Electron 데스크톱
│   ├── electron/    메인 프로세스, preload, 스텔스
│   └── src/         대시보드·로그인 UI
└── railway.json   빌드·실행 설정
```

## 문서

| 문서 | 내용 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 전체 구조·재생 모드·종료 감지·소켓·DB 스키마 |
| [docs/API.md](docs/API.md) | REST 엔드포인트 전체 (인증·rate limit 포함) |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 로컬 개발·환경변수·마이그레이션·테스트·배포·트러블슈팅 |
| [AGENTS.md](AGENTS.md) | AI 도구 협업 규칙 (도구 무관 계약) |
| [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md) | 커밋 메시지 형식 |

> AI 도구별 어댑터 `CLAUDE.md` · `GEMINI.md` · `.cursor/rules` 는 모두 `AGENTS.md` 계약을 참조한다.

## 라이센스

BSL 1.1
