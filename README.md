# Caffeine Flow

카페 손님이 QR로 음악을 신청하고, 사장님이 데스크톱에서 큐를 관리·재생하는 실시간 음악 추천 플랫폼.

YouTube · SoundCloud · Spotify 세 플랫폼을 한 화면에서 매장 BGM(고정) + 신청곡(임시 오버레이) 구조로 재생한다. 사장님 앱은 Chromium 기반 BrowserView 두 개를 띄워서 BGM은 끊김 없이 흐르고 신청곡만 위에 얹는다.

---

## 핵심 기능

### 손님 (모바일 브라우저)
- QR 스캔 → `https://<도메인>/{cafe_slug}` 경로로 진입
- YouTube / SoundCloud / Spotify 링크 신청 — 서버 oembed로 메타데이터 자동 파싱
- 실시간 큐 (Socket.IO) — 대기곡·재생 중·이력
- 곡 투표 / 댓글 / 답글
- 매장 TOP10 + 전체 카페 통합 TOP10
- `x-visitor-id` (브라우저 UUID) + IP 이중 키로 중복·도용 방지

### 사장님 (Electron 데스크톱 / Web)
- Google / Naver OAuth + JWT
- 신청 수락 · 거절 · 스킵 · 순서 변경(드래그)
- 자동수락 토글 — ON 시 추천곡(pending) → 대기곡(accepted) 자동 이동
- 대기곡 비어 있고 재생 슬롯 비면 자동 재생
- 공지 · 허용 플랫폼 토글 · 신청 ON/OFF · 카페명 변경
- 시간대 · 요일별 통계, 동시 접속 피크, 방문자 수
- 손님용 QR 코드 생성
- Spotify takeover 모드 (BGM=Spotify + rec=Spotify일 때 단일 세션으로 통합) / overlay 모드 (그 외)
- DataDome 봇 감지 우회 스텔스 (navigator.webdriver / WebGL / Canvas / AudioContext fingerprint 위장)
- SoundCloud 로그인 팝업 차단 + 자동재생 (`sendInputEvent`로 `isTrusted=true` 클릭 발화)
- 자동 업데이트 (electron-updater + GitHub Releases)

---

## 디렉토리 구조

```
proj1/
├── server/                Express + Postgres 백엔드 (v2, 활성)
│   ├── server.js          엔트리 — Railway가 이걸 실행
│   └── src/
│       ├── routes/        auth · cafes · recommendations(public/owner 분리) · song_comments · tracks · youtube
│       ├── services/      cafe · recommendation · song_comments · stats
│       ├── middleware/    auth (JWT 검증)
│       ├── socket/        Socket.IO /cafe namespace
│       ├── db/
│       │   ├── knex.js
│       │   ├── knexfile.js
│       │   └── migrations/   001 ~ 016 (cafes, recommendations, votes, comments, daily_stats, cafe_visits …)
│       ├── utils/         cafe-sanitize (사장님 응답 화이트리스트)
│       └── config.js      env 검증·로딩 (JWT_SECRET 필수)
│   └── public/            빌드 산출물 (Railway가 build 시 채워넣음)
│       ├── (customer SPA — gitignored, 매 배포 빌드)
│       └── owner/         (committed — Railway fallback용)
├── customer/              손님 SPA (Vite + React 18)
│   └── src/
│       ├── App.jsx        slug 파싱 후 CafePage
│       ├── pages/         CafePage · NowPlaying · RecommendForm · SongCard
│       ├── api.js · socket.js
│       └── deviceName.js · votedSongs.js  (localStorage 헬퍼)
├── owner/                 사장님 SPA + Electron 데스크톱
│   ├── electron/
│   │   ├── main.js                  메인 프로세스 (BrowserView 관리, Spotify/SC 종료 감지, 자동 업데이트)
│   │   ├── preload.js               메인 윈도우 IPC bridge
│   │   ├── stealth-preload.js       bgmView·recView 봇 감지 우회
│   │   └── youtube-preload.js       YouTube `<video>` ended 감지
│   ├── src/
│   │   ├── App.jsx                  로그인 분기
│   │   └── pages/                   DashboardPage · LoginPage · RecommendCard · StatsPanel
│   └── scripts/evs-sign.js          electron-builder afterPack 훅 (CastLabs EVS 서명)
├── extension/             (v1 Chrome 익스텐션, 미사용)
├── package.json           dev:* 통합 스크립트
└── railway.json           Railway 빌드·실행 설정 (NIXPACKS)
```

---

## 기술 스택

| 영역 | 도구 |
| --- | --- |
| 백엔드 런타임 | Node.js, Express 4, `express-async-errors`, `express-rate-limit` |
| DB | Postgres (Supabase) via Knex 3 — migration·query builder |
| 인증 | `google-auth-library`, Naver OAuth REST, `jsonwebtoken` |
| 실시간 | Socket.IO 4 (`/cafe` namespace, slug-room) |
| 손님 / 사장님 SPA | React 18, Vite 5, `socket.io-client` |
| 데스크톱 | Electron 41 (CastLabs `wvcus` 빌드 — Widevine CDM 내장) |
| 데스크톱 빌드 | `electron-builder` 26, `electron-updater` 6, NSIS, signtool |
| Widevine 서명 | CastLabs EVS (`python -m castlabs_evs.vmp`) — afterPack 훅 |
| QR | `qrcode` (서버 측 PNG 생성) |
| 배포 | Railway (NIXPACKS), GitHub Releases (Electron 인스톨러) |

---

## 환경변수

루트 `.env` (server·customer 공용 — server가 `path.resolve(__dirname, '../../.env')`로 로드):

| 키 | 필수 | 설명 |
| --- | :-: | --- |
| `PORT` | | 기본 3001 (Railway는 자체 PORT 주입) |
| `DATABASE_URL` | ✓ | Supabase Connection String. **누락 시 즉시 throw** |
| `JWT_SECRET` | ✓ | 32바이트+ 랜덤. **누락·`change-me-in-production`이면 즉시 throw** |
| `GOOGLE_CLIENT_ID` | OAuth 쓸 때 | Google Cloud Console에서 발급 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | OAuth 쓸 때 | Naver Developers 등록 |
| `APP_URL` | | OAuth redirect용 (기본 `http://localhost:5174`) — socket.io CORS allowlist에도 사용 |
| `SERVER_URL` | | Naver callback URI 등록 시 사용 |
| `YOUTUBE_API_KEY` | | 길이·라이브 체크. 미설정 시 기능 비활성 |

owner SPA 빌드 시 사용 (Vite `VITE_*`):
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_NAVER_ENABLED`

생성 한 줄: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 로컬 개발

```bash
# 1) 의존성 설치 (각 작업영역마다)
npm install                              # 루트
npm install --prefix server
npm install --prefix customer
npm install --prefix owner

# 2) .env 작성 (루트), Supabase + JWT_SECRET 필수

# 3) DB 마이그레이션
npm run migrate --prefix server

# 4) 동시 실행 (3개 터미널)
npm run dev:server     # http://localhost:3001
npm run dev:customer   # http://localhost:5173
npm run dev:owner      # http://localhost:5174

# 5) Owner Electron 데스크톱 개발 모드
cd owner && npm run electron:dev   # Vite + Electron 동시 기동
```

---

## DB 스키마 요약

```
cafes              — id, slug, owner_email, google_id/naver_id, is_accepting,
                     notice, allowed_platforms, address/road_address/region/district,
                     latitude/longitude, marketing_agreed, created_at, last_login_at
recommendations    — id, cafe_id, video_id (URL or YT id), title, status
                     (pending|accepted|playing|played|rejected|skipped),
                     vote_count, requester_ip, requester_name, visitor_id,
                     platform (youtube|soundcloud|spotify), duration, requested_at, played_at
votes              — recommendation_id, voter_ip / visitor_id (UNIQUE 제약)
comments           — recommendation_id, commenter_ip, commenter_name, body, parent_id (replies)
daily_stats        — cafe_id, date, peak_concurrent, total_visits
cafe_visits        — cafe_id, ip / visitor_id, visited_on (KST date, UNIQUE)
```

마이그레이션 16개 — `server/src/db/migrations/`.

---

## 배포

### 서버 (Railway)
`railway.json` 정의대로 git push 시 자동 빌드:

```
build: cd customer && npm i && npm run build
       && cd ../owner    && npm i && (VITE env inject) && npm run build
       && cd ../server   && npm i
start: npm run migrate --prefix server && node server/server.js
```

빌드 산출물 위치:
- `server/public/` — 손님 SPA (gitignored, Railway가 매번 빌드)
- `server/public/owner/` — 사장님 SPA (**committed** — Railway fallback). 소스 수정 후 로컬 빌드 → commit·push 해야 반영됨

### 사장님 데스크톱 (GitHub Releases)
로컬에서 직접:
```bash
cd owner
GH_TOKEN=<github_pat> npm run electron:build -- --publish always
```

흐름: Vite → electron-rebuild → packaging → **CastLabs EVS 서명** (binary upload, 213MB) → NSIS 인스톨러 → signtool 서명 → blockmap → GitHub Release 업로드 + `latest.yml` 생성. 매 빌드 5~15분.

업데이트: 설치된 클라이언트가 `latest.yml`을 polling → 새 인스톨러 다운로드 → 사용자가 재시작 트리거(`autoUpdater.quitAndInstall`).

---

## 아키텍처 노트

- **신청곡 재생 모드**:
  - `overlay` — bgmView는 음소거로 백그라운드 유지, recView가 위에 attach
  - `spotify-takeover` — BGM=Spotify + 신청=Spotify일 때 Connect 충돌 회피용으로 bgmView 안에서 신청곡 재생, 끝나면 원래 BGM 트랙으로 복귀
- **종료 감지**:
  - YouTube: `<video>` ended + duration 근접 timeupdate (youtube-preload)
  - Spotify: mediaSession `title|trackId` 시그니처 변화 2회 연속 → end
  - SoundCloud: 동일 패턴 — SC가 트랙 끝나면 자체 autoplay로 다음 곡 재생하므로 `<audio>` ended 안 발생, 시그니처 변화로 감지
- **SoundCloud 자동재생**: Chromium `autoplay-policy=no-user-gesture-required` 스위치 + `webContents.sendInputEvent` mouseDown/Up 시퀀스로 `isTrusted=true` 클릭 발화 (synthetic `.click()`은 SC player가 reject)
- **SoundCloud 로그인 팝업 차단**: `session.webRequest.onBeforeRequest`로 `secure.soundcloud.com/*` + `accounts.google.com/gsi/iframe*` cancel + insertCSS로 `.auth-modal/.modalWhiteout/.webAuthContainerWrapper/.onetapAuthContainer` display:none
- **앱 종료 처리**: `before-quit` 에서 polling 정리 + renderer로 `cleanup-before-quit` IPC → 현재 `playing` 상태 곡들 `played`로 마킹 (손님 화면에 가짜 "재생 중" 잔류 방지) → 3초 timeout fallback
- **Rate limiting**: 신청은 `x-visitor-id` (3/min) + IP (10/min) 이중 키 스택 — 헤더 위조 우회 차단

---

## 라이센스

BSL
