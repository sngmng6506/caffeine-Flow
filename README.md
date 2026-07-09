# Caffeine Flow

Caffeine Flow는 카페에서 손님 신청곡을 QR로 받고, 사장님이 데스크톱에서 안전하게 큐를 관리·재생하는 실시간 BGM 운영 도구다. YouTube · SoundCloud · Spotify 세 플랫폼을 한 화면에서 **매장 BGM(고정) + 신청곡(임시 오버레이)** 구조로 재생한다.

| | |
| --- | --- |
| **손님** | QR 스캔 → 모바일 브라우저에서 링크 신청·투표·댓글 (앱 설치 없음) |
| **사장님** | Electron 데스크톱 앱에서 큐 관리 + 실제 재생, 또는 웹 대시보드 |
| **백엔드** | Express + Postgres, Socket.IO 실시간 큐, Railway 배포 |
| **재생** | BrowserView 2개 (BGM 고정 / 신청곡 오버레이), 곡 종료 자동 감지 |
| **AI** | 사장님이 설정한 매장 분위기 정책을 기반으로 손님 신청곡을 LLM이 수락/거절 |

## 핵심 기능

- QR 기반 손님 신청곡 접수, 투표, 댓글
- 사장님 데스크톱 큐 관리와 BGM/신청곡 오버레이 재생
- YouTube · SoundCloud · Spotify 링크 메타데이터 자동 추출
- 매장 분위기 프롬프트 기반 AI 음악 필터: `accept` / `reject`만 사용, 오류 시 fail-closed
- Postgres + Socket.IO 기반 실시간 큐 동기화

## 기술 스택

React 18 · Vite 5 (손님·사장님 SPA) · Node.js · Express 4 · Knex 3 · Socket.IO 4 · PostgreSQL · Electron 41(CastLabs `wvcus`) · Google/Naver OAuth · Vitest/Supertest · Railway · GitHub Releases

## 빠른 시작

```bash
# 1) 의존성 설치
npm install && npm install --prefix server \
  && npm install --prefix customer && npm install --prefix owner

# 2) 루트에 .env 작성
# 필수: DATABASE_URL, JWT_SECRET
# AI 필터 사용 시: OPENAI_API_KEY
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

환경변수 전체 목록과 테스트·배포 명령은 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)를 참고한다.

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
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 설계 배경 — 재생 모드·종료 감지·소켓·DB 불변식 |
| [docs/API.md](docs/API.md) | REST 엔드포인트 전체 (인증·rate limit 포함) |
| [docs/LLM_FEATURES.md](docs/LLM_FEATURES.md) | LLM 기반 AI 음악 필터 설계 — 정책 설정·판단 흐름·실패 처리·통계 대시보드 |
| [docs/AI_CHANGE_GUARDRAILS.md](docs/AI_CHANGE_GUARDRAILS.md) | AI 코드 수정 시 깨지면 안 되는 상태·라우터·KST·SQL·LLM 계약 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 로컬 개발·환경변수·마이그레이션·테스트·배포 |
| [AGENTS.md](AGENTS.md) | AI 도구 협업 규칙 (도구 무관 계약) |
| [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md) | 커밋 메시지 형식 |

CI는 신규 커밋 메시지, 서버 테스트, customer/owner Vite build를 검사한다. 상세 명령은 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)를 따른다.

> AI 도구별 어댑터인 `CLAUDE.md` · `GEMINI.md` · `.cursor/rules`는 모두 `AGENTS.md`와 `docs/AI_CHANGE_GUARDRAILS.md` 계약을 참조한다.

## 라이선스

BSL 1.1
