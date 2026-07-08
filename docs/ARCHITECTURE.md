# 아키텍처

코드만 읽어서는 알기 어려운 설계 배경을 기록한다 — 외부 서비스 제약, 데이터 불변식, 상태 전이.
디렉토리 구조는 저장소를 직접 탐색하는 것이 정확하고, 라우트·규칙은 [API.md](API.md)와 [../AGENTS.md](../AGENTS.md)에 있다.

---

## 재생 파이프라인 (Electron)

사장님 앱은 BrowserView 두 개를 운용한다: **bgmView**(매장 BGM, 고정)와 **recView**(신청곡, 임시).

### 재생 모드
- **overlay** (기본) — bgmView는 음소거한 채 백그라운드로 유지하고, recView를 그 위에 얹는다. 신청곡이 끝나면 recView를 떼어내고 BGM의 음소거를 해제한다.
- **spotify-takeover** — BGM과 신청곡이 모두 Spotify인 경우. Spotify Connect는 계정당 재생 세션을 하나만 허용하기 때문에 두 View가 충돌한다. 그래서 bgmView 안에서 신청곡을 재생하고, 끝나면 원래 BGM 트랙과 위치로 되돌아간다.

### 곡 종료 감지
플랫폼마다 감지 방식이 다르다.
- **YouTube** — `<video>` ended 이벤트 + duration 근접 timeupdate (youtube-preload)
- **Spotify** — mediaSession의 `title|trackId` 시그니처가 두 번 연속 바뀌면 종료로 판정한다. Spotify가 자체 autoplay로 다음 곡을 이어 재생해서 ended 이벤트가 발생하지 않기 때문이다.
- **SoundCloud** — 같은 시그니처 방식을 쓴다. SoundCloud도 트랙이 끝나면 자체 autoplay로 넘어가서 `<audio>` ended가 발생하지 않는다.

### SoundCloud 자동재생
Chromium `autoplay-policy=no-user-gesture-required` 스위치와 `webContents.sendInputEvent`의 mouseDown/Up 시퀀스를 조합해 `isTrusted=true`인 클릭을 발생시킨다. SoundCloud 플레이어가 스크립트로 만든 `.click()`은 거부하기 때문이다.

### SoundCloud 로그인 팝업 차단
`session.webRequest.onBeforeRequest`로 `secure.soundcloud.com/*`과 `accounts.google.com/gsi/iframe*` 요청을 취소하고, `insertCSS`로 인증 모달(`.auth-modal` 등)을 `display:none` 처리한다.

### 봇 감지 우회 (stealth-preload)
DataDome을 우회하기 위해 `navigator.webdriver`와 WebGL·Canvas·AudioContext fingerprint를 위장한다.

### 앱 종료 처리
`before-quit` 시점에 polling을 정리하고, renderer로 `cleanup-before-quit` IPC를 보내 현재 `playing` 상태인 곡들을 `played`로 마킹한다. 손님 화면에 "재생 중" 표시가 잘못 남는 걸 막기 위해서다. 마킹이 늦어질 경우를 대비해 3초 timeout fallback을 둔다.

---

## 실시간 통신 (Socket.IO)

- `/cafe` namespace를 쓰고, 카페 slug별로 room을 나눈다. 손님과 사장님 모두 자기 카페의 slug room에 join한다.
- 서버는 신청·투표·상태 변경이 있을 때 해당 room에 `recommendations_update` 이벤트를 broadcast한다.
- **owner 소켓 인증** — `role=owner`는 handshake query만으로 신뢰하지 않는다. `handshake.auth.token`에 담긴 JWT를 검증하고 payload의 slug까지 일치해야 owner로 인정한다. 검증에 실패하면 손님으로 강등하되 연결은 유지한다(브로드캐스트로 받는 내용은 어차피 공개 정보라서다).
- **peak concurrent** — 손님이 입장할 때 room 크기에서 owner 소켓 수를 뺀 값으로 일일 최고 동시 접속자 수를 갱신한다. 날짜 기준은 KST다.

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


### 상태 전이
```
pending ⇄ accepted ⇄ playing  →  played / skipped
                    ↘ (거절) rejected
```
- 활성 상태(pending·accepted·playing) 사이에서는 양방향 전이를 허용한다(사장님 드래그 UI 때문).
- 종료 상태(played·skipped·rejected)에서 다른 상태로 되돌리는 전이는 서비스 레이어에서 409로 막는다.
