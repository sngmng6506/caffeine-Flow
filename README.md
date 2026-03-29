# ☕ Caffeine Flow

> 카페 손님이 QR 코드를 스캔해 YouTube URL로 음악을 신청하면, 카페 PC의 YouTube가 자동으로 전환되는 뮤직 리퀘스트 시스템

---

## 목차

- [주요 기능](#주요-기능)
- [시스템 아키텍처](#시스템-아키텍처)
- [프로젝트 구조](#프로젝트-구조)
- [기술 스택](#기술-스택)
- [시작하기](#시작하기)
- [Railway 배포](#railway-배포)
- [크롬 익스텐션 설치](#크롬-익스텐션-설치)
- [화면 구성](#화면-구성)
- [보안](#보안)
- [향후 계획](#향후-계획)

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 🔗 URL 신청 | YouTube URL 붙여넣기 → 곡 정보 자동 조회 후 신청 |
| 📡 실시간 동기화 | Socket.io로 신청 즉시 모든 화면에 반영 |
| 🎬 자동 탭 제어 | 신청곡 재생 시 기존 YouTube 탭 자동 음소거 |
| 🔁 자동 재생 | 곡 종료 시 자동으로 다음 신청 곡 재생 후 원래 음악 복원 |
| 💿 LP 애니메이션 | Admin 페이지에서 재생 중 회전하는 LP판 + 앨범아트 표시 |
| ⏭ 스킵 / 삭제 | 관리자가 곡을 강제 스킵하거나 큐에서 제거 |
| 🔛 시스템 ON/OFF | 손님 신청 기능을 즉시 켜고 끄기 |
| 🔒 토큰 + Rate Limit | 무작위 접근 및 스팸 신청 차단 |
| 📊 이력 & 통계 | 재생 이력 저장, TOP 10 신청곡, 시간대별 통계 |

---

## 시스템 아키텍처

### 전체 구조

```mermaid
graph TD
    subgraph 손님["📱 손님 폰 (LTE / WiFi 무관)"]
        QR[QR 스캔]
        WEB[모바일 웹]
    end

    subgraph 클라우드["☁️ Railway 클라우드"]
        SERVER[Node.js 서버]
        QUEUE[Queue 모듈]
        HISTORY[History 모듈]
    end

    subgraph 카페PC["🖥️ 카페 PC"]
        EXT[크롬 익스텐션]
        YT_기존[기존 YouTube 탭]
        ADMIN[Admin 페이지]
    end

    QR --> WEB
    WEB -->|"Socket.io (신청/큐 확인)"| SERVER
    SERVER --> QUEUE --> HISTORY
    QUEUE -->|"Socket.io (큐 동기화)"| WEB
    QUEUE -->|"Socket.io (큐 동기화)"| ADMIN
    QUEUE -->|"WS: play_song"| EXT
    EXT -->|음소거 & 새 탭 열기| YT_기존
    EXT -->|"WS: song_ended"| SERVER
```

---

### 신청부터 재생까지 (Sequence)

```mermaid
sequenceDiagram
    actor 손님 as 📱 손님
    participant 서버 as ☁️ Railway 서버
    participant YT_OE as 🌐 YouTube oEmbed
    participant 익스텐션 as 🔌 크롬 익스텐션
    participant YT_기존 as 🎵 기존 YouTube 탭

    손님->>서버: GET /api/oembed?url=유튜브URL
    서버->>YT_OE: oEmbed 요청 (무료, API 키 없음)
    YT_OE-->>서버: title, channelTitle
    서버-->>손님: 곡 정보 반환 (미리보기)

    손님->>서버: Socket → request_song
    서버->>서버: Rate Limit 검사 (1분 3곡)
    서버->>서버: 큐 추가 + 이력 기록
    서버-->>익스텐션: WS → play_song { videoId }

    익스텐션->>YT_기존: 음소거
    익스텐션->>익스텐션: 신청곡 새 탭으로 열기
    Note over 익스텐션: 영상 종료 감지 (content.js)

    익스텐션->>서버: WS → song_ended
    익스텐션->>YT_기존: 음소거 해제
    서버->>서버: 큐에서 제거 → 다음 곡 or 대기
```

---

### 보안 흐름

```mermaid
flowchart LR
    REQ[요청]
    TOKEN{토큰 검증}
    RATE{Rate Limit\n1분 20req / 3곡}
    OK[처리]
    BLOCK1[403 Forbidden]
    BLOCK2[429 Too Many Requests]

    REQ --> TOKEN
    TOKEN -->|불일치| BLOCK1
    TOKEN -->|일치| RATE
    RATE -->|초과| BLOCK2
    RATE -->|통과| OK
```

---

## 프로젝트 구조

```
caffeine-Flow/
├── server.js              # 진입점
├── railway.json           # Railway 배포 설정
├── src/
│   ├── config.js          # 환경변수
│   ├── state.js           # 공유 상태
│   ├── queue.js           # 큐 로직
│   ├── history.js         # 이력 저장 & 통계
│   ├── api.js             # REST API (Rate Limit 포함)
│   ├── socket.js          # Socket.io (신청 Rate Limit 포함)
│   └── extension.js       # 익스텐션 WebSocket 서버
├── public/
│   ├── customer.html      # 손님 모바일 페이지
│   └── admin.html         # 관리자 페이지 (큐/이력/통계)
├── extension/
│   ├── manifest.json
│   ├── background.js      # YouTube 탭 제어
│   ├── content.js         # 영상 종료 감지
│   ├── popup.html
│   └── popup.js
├── data/
│   └── history.json       # 재생 이력 (자동 생성, git 제외)
└── .env                   # 환경변수 (git 제외)
```

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| **런타임** | Node.js |
| **서버 프레임워크** | Express |
| **실시간 통신** | Socket.io |
| **익스텐션 통신** | WebSocket (ws) |
| **프론트엔드** | Vanilla HTML/CSS/JS |
| **곡 정보 조회** | YouTube oEmbed API (무료, API 키 불필요) |
| **음악 재생** | 카페 PC YouTube 탭 (Premium 유지) |
| **Rate Limiting** | express-rate-limit |
| **이력 저장** | JSON 파일 (`data/history.json`) |
| **브라우저 제어** | Chrome Extension (Manifest V3) |
| **배포** | Railway |

---

## 시작하기

### 1. 저장소 클론

```bash
git clone https://github.com/sngmng6506/caffeine-Flow.git
cd caffeine-Flow
```

### 2. 의존성 설치

```bash
npm install
```

### 3. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일 수정:

```env
PORT=3000
CAFE_TOKEN=your-random-token-here
```

> 토큰 랜덤 생성:
> ```bash
> node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
> ```

### 4. 로컬 실행

```bash
node server.js
# 또는 개발 모드
npm run dev
```

---

## Railway 배포

### 1. Railway 가입 & 프로젝트 생성
1. [railway.app](https://railway.app) 접속 → GitHub 로그인
2. **New Project** → **Deploy from GitHub repo** → `caffeine-Flow` 선택

### 2. 환경변수 설정
Railway 대시보드 → Variables 탭:

```
CAFE_TOKEN = (랜덤 생성한 토큰)
```

### 3. 배포 완료
- push할 때마다 자동 배포
- 도메인 자동 발급: `https://caffeine-flow-xxxx.railway.app`

### 4. QR 코드 생성
배포된 URL로 QR 생성:
```
https://caffeine-flow-xxxx.railway.app/customer.html?token=토큰
```

> 손님은 **LTE든 WiFi든** QR 스캔만 하면 됩니다.

---

## 크롬 익스텐션 설치

1. 크롬 주소창에 `chrome://extensions` 입력
2. 우측 상단 **개발자 모드** 활성화
3. **압축 해제된 확장 프로그램 로드** → `extension/` 폴더 선택
4. 익스텐션 아이콘 클릭 → **Server URL**에 Railway 주소 입력 → **저장 & 재연결**
5. 배지에 `ON` 표시되면 연결 완료

---

## 화면 구성

### 손님 화면 (Mobile)
- YouTube URL 붙여넣기 → 곡 미리보기 확인 → 신청
- 현재 신청 목록 실시간 확인
- 시스템 OFF / Rate Limit 초과 시 안내 메시지

### 관리자 화면 (PC)

| 탭 | 내용 |
|----|------|
| 신청 목록 | 현재 큐, 스킵/삭제, 시스템 ON·OFF, 익스텐션 연결 상태 |
| 이력 | 재생/스킵 곡 목록 + 시간 기록 |
| 통계 | 전체 신청 수, 재생 완료, 스킵률, 시간대별 차트, TOP 10 |

---

## 보안

| 방법 | 내용 |
|------|------|
| **랜덤 토큰** | 추측 불가능한 토큰으로 무작위 접근 차단 |
| **API Rate Limit** | IP당 1분 20요청 제한 |
| **신청 Rate Limit** | IP당 1분 3곡 신청 제한 |

---

## 향후 계획

- [ ] 테이블별 고유 QR 코드 생성
- [ ] 좋아요 / 투표 기반 큐 정렬
- [ ] Redis를 이용한 큐 영속성 (서버 재시작 후 복구)
