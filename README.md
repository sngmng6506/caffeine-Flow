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

- 앱 설치 없는 QR 기반 신청곡 접수
- 사장님용 실시간 큐 관리
- YouTube·SoundCloud·Spotify 메타데이터 처리
- 매장 BGM과 신청곡의 overlay 재생
- 매장 분위기 프롬프트 기반 AI 음악 필터
- 투표·댓글·재생 이력·운영 통계
- Google·Naver 로그인과 Electron 자동 업데이트

AI 음악 필터는 `accept` 또는 `reject`만 사용하며 오류 시 fail-closed로 동작한다.

## 기술 스택

React · Vite · Node.js · Express · Knex · Socket.IO · PostgreSQL · Electron · Vitest · Railway

## 빠른 시작

```bash
# 의존성 설치
npm install
npm install --prefix server
npm install --prefix customer
npm install --prefix owner

# 루트 .env에 DATABASE_URL, JWT_SECRET 설정
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# DB와 개발 서버
npm run migrate --prefix server
npm run dev:server
npm run dev:customer
npm run dev:owner

# Electron 개발 모드
npm run electron:dev --prefix owner
```

환경변수와 테스트·배포 방법은 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)를 참고한다.

## 저장소 구조

```text
server/           API·Socket.IO·PostgreSQL
customer/         손님 React SPA
owner/src/        사장님 React UI
owner/electron/   데스크톱 재생 엔진
admin/            플랫폼 운영자 정적 콘솔
```

## 문서

전체 문서 지도: [docs/README.md](docs/README.md)

| 문서 | 역할 |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 시스템 경계·데이터 흐름·상태 모델 |
| [PLAYBACK.md](docs/PLAYBACK.md) | Electron 재생 엔진과 플랫폼 제약 |
| [API.md](docs/API.md) | REST 엔드포인트 레퍼런스 |
| [admin/README.md](admin/README.md) | 플랫폼 운영자 콘솔의 화면과 API 경계 |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | 환경변수·테스트·배포 |
| [LLM_FILTER.md](docs/LLM_FILTER.md) | 현재 AI 음악 필터 동작 |
| [AI_CHANGE_GUARDRAILS.md](docs/AI_CHANGE_GUARDRAILS.md) | 변경 시 유지할 코드 계약 |
| [ROADMAP.md](docs/ROADMAP.md) | 아직 구현되지 않은 개선 후보 |
| [Customer Design Guide](customer/DESIGN_GUIDE.md) | 손님 화면 Soft Streaming 디자인 기준 |
| [Customer Writing Guide](customer/WRITING_GUIDE.md) | 손님 화면 목소리·용어·UI 문구 기준 |
| [Owner Design Guide](owner/DESIGN_GUIDE.md) | 사장님 화면 Calm Operations 디자인 기준 |
| [Owner Writing Guide](owner/WRITING_GUIDE.md) | 사장님 화면 목소리·용어·UI 문구 기준 |
| [AGENTS.md](AGENTS.md) | 사람·AI 도구 공통 작업 규칙 |

## 라이선스

[MIT](LICENSE)
