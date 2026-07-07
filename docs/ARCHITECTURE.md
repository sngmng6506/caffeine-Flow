# 아키텍처

Caffeine Flow의 심화 구조 문서. 재생 파이프라인, 실시간 통신, 데이터 모델을 다룬다.

---

## 디렉토리 구조

```
├── server/                    Express + Postgres 백엔드 (배포 대상)
│   ├── app.js                 Express 앱 조립 — 라우트·미들웨어·정적 서빙.
│   │                          포트 리슨/소켓 없이 export → supertest가 import
│   ├── server.js              HTTP 서버 + Socket.IO 리슨 (Railway 실행 엔트리)
│   └── src/
│       ├── routes/            auth · cafes · recommendations(public/owner 분리)
│       │                      · song_comments · tracks
│       │   └── _recommendations.shared.js   공용 유틸(IP·visitor·rate limiter 팩토리)
│       ├── services/          cafe · recommendation · song_comments · stats
│       ├── middleware/        auth (requireAuth · requireCafeOwner)
│       ├── socket/            Socket.IO /cafe namespace, peak concurrent 집계
│       ├── db/
│       │   ├── knex.js · knexfile.js
│       │   └── migrations/    001 ~ 018
│       ├── utils/             cafe-sanitize · validate · kst
│       └── config.js          env 검증·로딩 (JWT_SECRET·DATABASE_URL 필수)
│   └── public/                빌드 산출물
│       ├── (customer SPA)     gitignored, Railway가 매 배포 빌드
│       └── owner/             committed — Railway fallback용
├── customer/                  손님 SPA (Vite + React 18)
│   └── src/
│       ├── App.jsx            slug 파싱 → CafePage
│       ├── pages/             CafePage · RecommendForm · SongCard 등
│       └── api.js · socket.js
└── owner/                     사장님 SPA + Electron
    ├── electron/
    │   ├── main.js            메인 프로세스 (BrowserView 관리, 종료 감지, 자동 업데이트)
    │   ├── preload.js         메인 윈도우 IPC bridge
    │   ├── stealth-preload.js bgmView·recView 봇 감지 우회
    │   └── youtube-preload.js YouTube <video> ended 감지
    ├── src/
    │   ├── App.jsx            OAuth 콜백 파싱(fragment) · 로그인 분기
    │   └── pages/
    │       ├── DashboardPage.jsx     메인 대시보드
    │       └── dashboard/            탭별 서브컴포넌트(분리됨)
    └── scripts/evs-sign.js    electron-builder afterPack (CastLabs EVS 서명)
```

---

## 서버 부팅 구조

`app.js`와 `server.js`가 분리돼 있다.

- **`app.js`** — Express 앱을 조립하고 `{ app, corsOriginCheck }`를 export. 포트를 열지 않으므로 테스트가 `import`해서 supertest로 요청을 넣을 수 있다.
- **`server.js`** — `app`을 감싼 HTTP 서버에 Socket.IO를 붙이고 리슨. Railway가 실행하는 실제 엔트리.

라우트가 `req.app.get('io')`로 소켓을 참조하는 부분은 옵셔널 체이닝(`?.`)이라, 소켓이 없는 테스트 환경에서도 안전하다.

---

## 재생 파이프라인 (Electron)

사장님 앱은 BrowserView 두 개를 운용한다: **bgmView**(매장 BGM, 고정)와 **recView**(신청곡, 임시).

### 재생 모드
- **overlay** (기본) — bgmView는 음소거로 백그라운드 유지, recView를 위에 attach. 신청곡이 끝나면 recView를 떼고 BGM 음소거 해제.
- **spotify-takeover** — BGM=Spotify + 신청곡=Spotify일 때. Spotify Connect는 계정당 단일 재생 세션만 허용하므로 두 View가 충돌한다. 이 경우 bgmView 안에서 신청곡을 재생하고, 끝나면 원래 BGM 트랙·위치로 복귀.

### 곡 종료 감지
플랫폼마다 방식이 다르다.
- **YouTube** — `<video>` ended 이벤트 + duration 근접 timeupdate (youtube-preload)
- **Spotify** — mediaSession의 `title|trackId` 시그니처가 2회 연속 변하면 종료로 판정 (Spotify는 자체 autoplay로 다음 곡을 재생하므로 ended가 안 뜸)
- **SoundCloud** — 동일 시그니처 방식. SC도 트랙 종료 시 자체 autoplay로 넘어가 `<audio>` ended가 발생하지 않음

### SoundCloud 자동재생
Chromium `autoplay-policy=no-user-gesture-required` 스위치 + `webContents.sendInputEvent`의 mouseDown/Up 시퀀스로 `isTrusted=true` 클릭을 발화한다. synthetic `.click()`은 SC player가 거부하기 때문.

### SoundCloud 로그인 팝업 차단
`session.webRequest.onBeforeRequest`로 `secure.soundcloud.com/*`·`accounts.google.com/gsi/iframe*`를 취소하고, `insertCSS`로 인증 모달(`.auth-modal` 등)을 `display:none` 처리.

### 봇 감지 우회 (stealth-preload)
DataDome 대응으로 `navigator.webdriver`·WebGL·Canvas·AudioContext fingerprint를 위장.

### 앱 종료 처리
`before-quit`에서 polling을 정리하고 renderer로 `cleanup-before-quit` IPC를 보내 현재 `playing` 상태 곡들을 `played`로 마킹한다 (손님 화면에 가짜 "재생 중" 잔류 방지). 3초 timeout fallback.

---

## 실시간 통신 (Socket.IO)

- `/cafe` namespace, slug별 room 구조. 손님·사장님 모두 자기 카페 slug room에 join.
- 서버는 신청/투표/상태 변경 시 해당 room에 `recommendations_update` 이벤트를 broadcast.
- **owner 소켓 인증** — `role=owner`는 handshake query만으로 신뢰하지 않는다. `handshake.auth.token`의 JWT를 검증하고 payload의 slug 일치까지 확인해야 owner로 인정. 실패 시 손님으로 강등(연결은 유지 — 브로드캐스트 수신은 공개 정보).
- **peak concurrent** — 손님 입장 시 room 크기에서 owner 소켓 수를 뺀 값으로 일일 최고 동시 접속을 갱신. 날짜는 KST 기준.

---

## 데이터 모델

```
cafes           id · slug · owner_email · google_id/naver_id · is_accepting
                notice · allowed_platforms · 주소/좌표 필드 · marketing_agreed
                created_at · last_login_at
recommendations id(uuid) · cafe_id · video_id · title · status · vote_count
                requester_ip(inet) · requester_name · visitor_id · platform
                duration · requested_at · played_at · playing_started_at
                play_duration_seconds
votes           recommendation_id · voter_ip(inet) — UNIQUE(rec_id, voter_ip)
comments        recommendation_id · commenter_ip · commenter_name · body
                parent_id (답글)
daily_stats     cafe_id · date · peak_concurrent · total_visits
cafe_visits     cafe_id · ip/visitor_id · visited_on (KST date) — UNIQUE
```

주요 제약·인덱스:
- **votes** `UNIQUE(recommendation_id, voter_ip)` — 중복 투표 차단 (23505 → 409)
- **cafe_visits** `UNIQUE(cafe_id, ip, visited_on)` — IP당 KST 하루 1회 방문 집계
- **recommendations** partial unique `(cafe_id, video_id) WHERE status IN (pending,accepted,playing)` (018) — 활성 큐 중복 신청을 DB 레벨에서 차단
- 조회 성능 인덱스 (017): `(cafe_id, status)`, `(cafe_id, requested_at)` 등

`recommendations.id`는 UUID(`gen_random_uuid()`)다. 마이그레이션에서 집계 시 `MIN(id)`는 uuid를 지원하지 않으므로 `ROW_NUMBER() OVER (... ORDER BY)`를 쓴다.

### 상태 전이
```
pending ⇄ accepted ⇄ playing  →  played / skipped
                    ↘ (거절) rejected
```
- 활성 상태(pending·accepted·playing) 간에는 양방향 전이 허용 (사장님 드래그 UI)
- 종료 상태(played·skipped·rejected)에서의 전이는 서비스 레이어에서 409로 차단

---

## 보안 요약

| 영역 | 방어 |
| --- | --- |
| 신청 도배 | `x-visitor-id`(3/min) + IP(10/min) 이중 rate limit |
| 투표·댓글 도배 | visitor+IP 이중 limiter (투표 15/40, 댓글 5/15) |
| 클라이언트 IP | `req.ip` 사용 (trust proxy 1) — X-Forwarded-For 위조 차단 |
| 신청 취소 | visitor_id 또는 requester_ip 일치 확인 (권한 상승 차단) |
| SSRF | 사용자 URL fetch는 safeAxiosGet — DNS 사설 IP 차단 + 리다이렉트 호스트 allowlist + 2MB 제한 |
| OAuth 토큰 | 콜백 시 URL fragment로 전달 (서버 로그·Referer 유출 방지) |
| 소켓 owner | handshake JWT 검증 + slug 일치 |
| body 크기 | express.json 64kb 제한 |
