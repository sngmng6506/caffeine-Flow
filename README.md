# Caffeine Flow

> 카페 손님이 QR로 음악을 신청하고, 사장님이 데스크톱에서 큐를 관리·재생하는 실시간 음악 추천 플랫폼.

YouTube · SoundCloud · Spotify 세 플랫폼을 한 화면에서 **매장 BGM(고정) + 신청곡(임시 오버레이)** 구조로 재생한다. 사장님 앱은 Chromium 기반 BrowserView 두 개를 띄워 BGM은 끊김 없이 흐르고 신청곡만 위에 얹는다.

---

## 한눈에 보기

| | |
| --- | --- |
| **손님** | QR 스캔 → 모바일 브라우저에서 링크 신청·투표·댓글 (앱 설치 없음) |
| **사장님** | Electron 데스크톱 앱에서 큐 관리 + 실제 재생, 또는 웹 대시보드 |
| **백엔드** | Express + Postgres, Socket.IO 실시간 큐, Railway 배포 |
| **재생** | BrowserView 2개 (BGM 고정 / 신청곡 오버레이), 곡 종료 자동 감지 |

---

## 빠른 시작

```bash
# 1) 의존성 설치
npm install && npm install --prefix server \
  && npm install --prefix customer && npm install --prefix owner

# 2) 루트에 .env 작성 (docs/DEVELOPMENT.md 참고 — DATABASE_URL·JWT_SECRET 필수)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # JWT_SECRET 생성

# 3) DB 마이그레이션
npm run migrate --prefix server

# 4) 개발 서버 (각 터미널)
npm run dev:server     # http://localhost:3001
npm run dev:customer   # http://localhost:5173
npm run dev:owner      # http://localhost:5174

# 5) 사장님 데스크톱 개발 모드
cd owner && npm run electron:dev
```

자세한 개발 환경 설정·환경변수·트러블슈팅은 **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

---

## 기능

### 손님 (모바일 브라우저)
- QR 스캔 → `/{cafe_slug}` 진입, 앱 설치 불필요
- YouTube / SoundCloud / Spotify 링크 신청 — 서버 oembed로 메타데이터 자동 파싱
- 실시간 큐 (Socket.IO): 대기곡 · 재생 중 · 이력
- 곡 투표 · 댓글 · 답글
- 매장 TOP10 + 전체 카페 통합 TOP10
- `x-visitor-id`(브라우저 UUID) + IP 이중 키로 중복·도용 방지

### 사장님 (Electron 데스크톱 / Web)
- Google / Naver OAuth + JWT
- 신청 수락 · 거절 · 스킵 · 순서 변경
- 자동수락 토글, 대기곡·재생 슬롯 자동 진행
- 공지 · 허용 플랫폼 · 신청 ON/OFF · 카페명
- 시간대 · 요일별 통계, 동시 접속 피크, 방문자 수
- 손님용 QR 생성
- Spotify takeover / overlay 재생 모드, 곡 종료 자동 감지
- 자동 업데이트 (electron-updater + GitHub Releases)

---

## 기술 스택

| 영역 | 도구 |
| --- | --- |
| 백엔드 | Node.js, Express 4, Knex 3, Socket.IO 4 |
| DB | PostgreSQL |
| 인증 | Google / Naver OAuth, `jsonwebtoken` |
| SPA | React 18, Vite 5 |
| 데스크톱 | Electron 41 (CastLabs `wvcus` — Widevine CDM 내장), electron-builder / updater |
| 배포 | Railway (NIXPACKS), GitHub Releases |
| 테스트 | Vitest, Supertest |

---

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
├── extension/     (v1 Chrome 익스텐션, 미사용)
└── railway.json   빌드·실행 설정
```

전체 디렉토리 트리와 각 파일 역할은 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## 문서

| 문서 | 내용 |
| --- | --- |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | 재생 모드·종료 감지·소켓·DB 스키마 등 심화 구조 |
| **[docs/API.md](docs/API.md)** | REST 엔드포인트 전체 목록 (인증·rate limit 포함) |
| **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** | 로컬 개발·환경변수·마이그레이션·배포 |
| **[AGENTS.md](AGENTS.md)** | AI 도구 협업 규칙 (Claude Code / Codex / Gemini) |
| **[COMMIT_CONVENTION.md](COMMIT_CONVENTION.md)** | 커밋 메시지 형식 |

---

## 라이센스

BSL 1.1
