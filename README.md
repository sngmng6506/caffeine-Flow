# Caffeine Flow

카페 손님이 QR로 음악을 신청하고, 사장님이 데스크톱에서 큐를 관리·재생하는 실시간 BGM 운영 도구다.

```text
손님 모바일 웹  → 신청·투표·댓글
Express 서버    → 검증·저장·Socket.IO 동기화
사장님 앱       → 수락·재생·스킵·운영 설정
Electron        → YouTube·SoundCloud·Spotify 실제 재생
운영자 콘솔     → 전체 카페 상태·사용량·정지 관리
```

## 핵심 기능

- 앱 설치 없는 QR 기반 신청곡 접수와 실시간 큐 관리
- YouTube·SoundCloud·Spotify 메타데이터 처리와 overlay 재생
- 매장 분위기 설명 기반 AI 음악 필터. 판단은 `accept`/`reject`뿐이고 오류는 fail-closed다
- 투표·댓글·재생 이력·운영 통계
- Google·Naver 로그인과 Electron 자동 업데이트

## 기술 스택

React · Vite · Node.js · Express · Knex · Socket.IO · PostgreSQL · Electron · Vitest · Railway

## 빠른 시작

```bash
# 의존성 설치
npm ci --prefix server
npm ci --prefix customer
npm ci --prefix owner

# 루트 .env에 DATABASE_URL, JWT_SECRET 설정
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# DB와 개발 서버 (각각 다른 터미널)
npm run migrate --prefix server
npm run dev:server
npm run dev:customer
npm run dev:owner

# Electron 개발 모드
npm run electron:dev --prefix owner
```

환경변수와 테스트·배포 방법은 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)에 있다.

## 저장소 구조

```text
server/           API·Socket.IO·PostgreSQL
customer/         손님 React SPA
owner/src/        사장님 React UI
owner/electron/   데스크톱 재생 엔진
admin/            플랫폼 운영자 정적 콘솔
```

## 문서

- 전체 문서 지도: [docs/README.md](docs/README.md)
- 코드를 수정하기 전 읽을 작업 계약: [AGENTS.md](AGENTS.md)
- 깨뜨리면 안 되는 코드 계약: [docs/AI_CHANGE_GUARDRAILS.md](docs/AI_CHANGE_GUARDRAILS.md)

## 라이선스

[MIT](LICENSE)
