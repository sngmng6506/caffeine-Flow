# ☕ Caffeine Flow

> 카페 매장음악을 유튜브로 재생하면서, 손님이 QR 코드로 음악을 신청하면 매장음악이 자동 일시정지되고 신청곡이 재생되는 뮤직 리퀘스트 시스템

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 🎵 매장음악 재생 | Admin 페이지에서 유튜브 검색 → 클릭으로 바로 재생 |
| 🔗 URL 신청 | 손님이 YouTube URL 붙여넣기 → 곡 정보 자동 조회 후 신청 |
| ⏸ 자동 전환 | 신청곡 들어오면 매장음악 일시정지 → 신청 큐 소진 후 자동 재개 |
| 📡 실시간 동기화 | Socket.io로 신청 즉시 모든 화면에 반영 |
| 🎬 자동 재생 | Admin 페이지에서 순서대로 자동 재생 |
| 💿 LP 애니메이션 | 신청곡 재생 중 회전하는 LP판 + 앨범아트 |
| ⏭ 스킵 / 삭제 | 관리자가 곡을 강제 스킵하거나 큐에서 제거 |
| 🔛 시스템 ON/OFF | 손님 신청 기능을 즉시 켜고 끄기 |
| 🔒 토큰 + Rate Limit | 무작위 접근 및 스팸 신청 차단 |
| 📊 이력 & 통계 | 재생 이력 저장, TOP 10 신청곡, 시간대별 통계 |

---

## 시스템 아키텍처

```
손님 (모바일)                      카페 PC (Admin)
     │                                  │
     │  QR 스캔 → customer.html         │  admin.html
     │  YouTube URL 붙여넣기            │  ┌─────────────────────────┐
     │  → /api/oembed 조회              │  │ 왼쪽: 신청곡 LP 플레이어 │
     │  → Socket: request_song          │  │ 오른쪽 탭:              │
     │                                  │  │  - 음악 재생 (검색+재생) │
     └──────────┐                       │  │  - 신청 목록            │
                ▼                       │  │  - 이력 / 통계 / QR    │
         ☁️ Node.js 서버               │  └─────────────────────────┘
         (Express + Socket.io)          │
         ├── queue.js (큐 관리)         │
         ├── history.js (이력/통계)     │
         └── youtube-sr (검색)          │
                │                       │
                └───── Socket ──────────┘
```

### 신청 → 재생 흐름

1. 손님이 YouTube URL을 붙여넣고 신청
2. 서버가 큐에 추가 → 모든 클라이언트에 `queue_update` 전송
3. Admin 페이지에서 매장음악(default 플레이어) **자동 일시정지**
4. 신청곡이 LP 플레이어(왼쪽)에서 자동 재생
5. 곡 종료 → 서버에 `song_ended` → 큐에서 제거 → 다음 곡 재생
6. 큐가 비면 → 매장음악 **자동 재개**

---

## 프로젝트 구조

```
caffeine-flow/
├── server.js              # 진입점: Express + Socket.io 조립
├── src/
│   ├── config.js          # 환경변수 (PORT, CAFE_TOKEN)
│   ├── state.js           # 공유 상태 싱글톤 (queue, isPlaying, isSystemOn)
│   ├── queue.js           # 큐 로직 (추가/스킵/삭제/종료/토글)
│   ├── history.js         # 이력 저장 & 통계 (JSON 파일 + 인메모리 캐시)
│   ├── api.js             # REST API (oEmbed, 검색, 큐, 이력, 통계)
│   └── socket.js          # Socket.io 이벤트 핸들러 (신청 Rate Limit)
├── public/
│   ├── admin.html         # 관리자 페이지 (매장음악 + 신청곡 + 큐/이력/통계/QR)
│   ├── customer.html      # 손님 모바일 페이지
│   ├── utils.js           # 공통 유틸 (escHtml)
│   └── favicon.svg        # 파비콘
├── extension/             # Chrome 확장 프로그램 (선택)
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   └── popup.js
├── data/
│   └── history.json       # 재생 이력 (자동 생성)
├── railway.json           # Railway 배포 설정
├── .env.example           # 환경변수 예시
└── package.json
```

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| **런타임** | Node.js |
| **서버** | Express |
| **실시간 통신** | Socket.io |
| **프론트엔드** | Vanilla HTML/CSS/JS |
| **곡 정보 조회** | YouTube oEmbed API (무료) |
| **유튜브 검색** | youtube-sr (무료, API 키 불필요) |
| **음악 재생** | YouTube IFrame Player API |
| **Rate Limiting** | express-rate-limit |
| **이력 저장** | JSON 파일 + 인메모리 캐시 |
| **배포** | Railway |

---

## 실행 방법

### 1. 의존성 설치

```bash
git clone https://github.com/sngmng6506/caffeine-Flow.git
cd caffeine-Flow
npm install
```

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 수정:
```env
PORT=3000
CAFE_TOKEN=your-random-token-here
```

토큰 랜덤 생성:
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### 3. 서버 실행

```bash
node server.js        # 일반 실행
npm run dev           # 개발 모드 (파일 변경 시 자동 재시작)
```

### 4. 접속

| 역할 | URL |
|------|-----|
| **관리자** | `http://localhost:3000/admin.html?token=토큰` |
| **손님** | `http://localhost:3000/customer.html?token=토큰` |

---

## 사용 흐름

### 관리자 (카페 PC)
1. Admin 페이지 접속
2. **음악 재생 탭**에서 유튜브 검색 → 클릭하여 매장음악 재생
3. 손님 신청이 들어오면 매장음악 자동 일시정지, 신청곡 자동 재생
4. 신청곡 큐 소진 후 매장음악 자동 재개
5. 필요 시 스킵 / 삭제 / 시스템 OFF

### 손님
1. QR 코드 스캔 (또는 URL 직접 접속)
2. YouTube에서 원하는 곡 찾기 → 공유 → URL 복사
3. 신청 페이지에 URL 붙여넣기 → 미리보기 확인 → 신청

---

## Admin 화면 구성

| 영역 | 내용 |
|------|------|
| **왼쪽 패널** | LP 애니메이션 + 신청곡 YouTube 플레이어 + 스킵/시스템 ON·OFF |
| **음악 재생 탭** | 유튜브 검색 + 결과 리스트 + 임베드 플레이어 (매장음악용) |
| **신청 목록 탭** | 현재 큐, 개별 삭제 |
| **이력 탭** | 재생/스킵 곡 목록 + 시간 기록 |
| **통계 탭** | 전체 신청 수, 재생 완료, 스킵률, 시간대별 차트, TOP 10 |
| **QR 코드 탭** | 손님용 QR 생성 + 인쇄/다운로드 |

---

## Railway 배포

1. [railway.app](https://railway.app) → GitHub 로그인
2. **New Project** → **Deploy from GitHub repo** → 저장소 선택
3. **Variables** 탭에서 `CAFE_TOKEN` 설정
4. `main` 브랜치 push 시 자동 배포
5. 발급된 도메인으로 QR 코드 생성 후 카페 테이블에 부착

---

## 보안

| 방법 | 내용 |
|------|------|
| **랜덤 토큰** | 추측 불가능한 토큰으로 무작위 접근 차단 |
| **API Rate Limit** | IP당 1분 60요청 제한 |
| **신청 Rate Limit** | IP당 1분 3곡 신청 제한 (메모리 누수 방지 자동 정리) |

---

## Chrome 확장 프로그램 (선택)

`extension/` 폴더에 크롬 확장이 포함되어 있습니다. 서버와 WebSocket으로 연결하여 신청곡을 크롬 탭에서 직접 재생하고, 기존 YouTube 탭을 자동 음소거하는 방식입니다. Admin 페이지의 임베드 플레이어만으로 충분하다면 설치하지 않아도 됩니다.
