# 재생 엔진

> **AI가 읽을 때:** Electron, BrowserView, BGM·신청곡 재생, 종료 감지, 플랫폼 DOM 우회, IPC를 수정할 때
> **함께 갱신할 때:** overlay/takeover, 플랫폼별 재생·복구 방식, 종료 신호, preload 계약이 달라질 때
> **생략 가능한 경우:** 재생과 무관한 일반 React UI·서버 API만 수정할 때

사장님 Electron 앱의 재생 구조와 플랫폼 제약을 설명한다. 전체 시스템 경계는 [ARCHITECTURE.md](ARCHITECTURE.md), 실행·배포 명령은 [DEVELOPMENT.md](DEVELOPMENT.md)를 따른다.

## 역할

매장 BGM을 유지하면서 신청곡을 잠시 재생한 뒤 원래 BGM으로 돌아온다.

```text
bgmView  매장 기본 BGM
recView  신청곡 임시 재생
```

렌더러는 큐 상태와 사용자 조작을, 메인 프로세스는 창 배치·플랫폼 재생·종료 감지를 담당한다. 같은 카페에 여러 화면이 연결돼도 서버가 선출한 Electron 한 대만 실제 재생과 재생 상태 발행을 맡고, 나머지 Electron과 브라우저는 큐만 보는 follower다.

## 재생 모드

**Overlay** — 대부분의 조합에서 두 BrowserView를 사용한다.

```text
BGM 재생 → BGM 음소거 → recView에서 신청곡 재생
→ 신청곡 종료 → recView 정리 → BGM 음소거 해제
```

**Spotify takeover** — BGM과 신청곡이 모두 Spotify이면 같은 계정의 재생 세션이 충돌하므로 `bgmView` 안에서 전환한다.

```text
현재 BGM 트랙·위치 저장 → 같은 뷰에서 신청곡 재생
→ 종료 감지 → 기존 트랙·위치 복구
```

## 플랫폼별 처리

| 플랫폼 | 재생 | 종료 감지 |
| --- | --- | --- |
| YouTube | 영상 URL 로드 | `<video>`의 `ended` 이벤트 |
| Spotify | 웹 플레이어/Connect 세션 | 트랙 제목 시그니처 변화 |
| SoundCloud | 웹 플레이어 | 트랙 제목 시그니처 변화 |

- Spotify와 SoundCloud는 자체 자동재생으로 다음 곡을 이어가므로 단순 `ended` 신호에 의존하지 않는다. 제목 시그니처가 일정 횟수 연속으로 달라지면 종료로 판단한다.
- 현재 곡 감지는 실제로 소리내며 재생 중인 미디어만 인정한다. 음소거 hover 미리보기가 mediaSession을 세팅해도 곡으로 잡지 않는다.
- 신청곡 재생 중 사장님이 플레이어를 신청곡 URL 밖으로 이동하면 `onRecLeft`로 이탈을 알린다. 원곡은 `played`로 종료만 하고 다음 곡 자동 재생이나 BGM 복귀는 하지 않는다. 사장님이 직접 조작 중이므로 방해하지 않는다.
- SoundCloud는 스크립트 클릭을 무시할 때가 있어 OS 수준 입력을 사용한다. 로그인 모달과 자동재생 방해 요소만 최소 범위로 차단한다. 이 우회는 DOM 변경에 민감하므로 수정 시 정상 재생 시작, 로그인·비로그인 상태, 종료 후 BGM 복귀, 클릭 좌표와 창 크기 변화를 확인한다.

## 보안 경계

Electron은 DRM 재생을 위해 CastLabs Electron과 Widevine을 사용한다. 외부 페이지 대응 코드는 공격면을 넓히기 쉬우므로 다음을 지킨다.

- IPC 채널을 임의로 확장하지 않고, 사장님 메인 renderer에서 온 이벤트만 처리한다.
- 신청곡은 서버가 서명한 메타데이터의 플랫폼·ID만 재생한다.
- 기본 BGM URL은 YouTube·SoundCloud·Spotify HTTPS host allowlist를 통과해야 한다.
- 외부 음악·팝업 WebContents는 Chromium sandbox를 사용한다. YouTube preload는 `contextIsolation`을 켜고, main world 보정이 필요한 Spotify/SoundCloud·로그인 stealth preload만 격리 예외로 둔다.
- 외부 음악 페이지에 camera/microphone을 포함하는 `media` 권한을 주지 않으며 DRM 권한만 허용된 음악 origin에 부여한다.
- 외부 페이지 DOM 조작은 플랫폼별 어댑터 경계 안에 둔다.
- 로그인 정보와 토큰을 로그에 남기지 않는다.

## 이벤트 계약

아래는 재생 흐름의 주요 이벤트다. 전체 공개 API는 `owner/electron/preload.js`, 메인 IPC 처리는 각 책임 모듈이 기준이다.

```text
playRec             신청곡 URL 검증·navigation 요청. Promise<{ ok, error? }>
endRec              신청곡 종료 처리 및 BGM 복귀
setBgmUrl           기본 BGM 설정. Promise<boolean>
clearBgm            기본 BGM 해제. Promise<boolean>
isRecActive         메인 프로세스의 실제 신청곡 재생 모드 조회
onVideoEnded        신청곡 정상 종료. 다음 곡 자동 재생
onRecLeft           신청곡 이탈. 원곡 종료만, 자동 재생 없음
onNowPlaying        현재 재생 정보
onPlaybackState     재생·일시정지·버퍼링 상태
onCurrentTrack      현재 BrowserView에서 감지한 공개 곡 메타데이터
onManualTrackEnded  직접 재생곡 종료. playback_history 기록을 트리거
onWidevineStatus    Widevine 상태
setPanelRatio       렌더러/BrowserView 경계 조정
setPanelCollapsed   사장님 화면을 48px 상태 레일로 접거나 복원
```

- `on*` 구독 함수는 해당 리스너만 제거하는 해제 함수를 반환한다. 컴포넌트 정리 시 다른 화면의 구독을 일괄 삭제하지 않는다.
- 패널을 접을 때 `bgmView`와 `recView`를 제거하지 않고 bounds만 바꾼다. 접힘 상태는 재시작·reload 시 초기화하고 마지막 펼친 비율만 로컬에 보존한다.

## 재생 상태와 현재 곡

- 재생 상태는 DB `playing`과 분리된 실시간 신호다. Electron이 `playing`, `paused`, `buffering`, `unknown` 중 하나를 보내고 서버는 현재 재생 리더의 신호만 카페 룸에 전달한다. 신호가 만료되거나 연결이 끊기면 `unknown`으로 초기화하고 DB 상태는 바꾸지 않는다.
- 현재 곡 메타데이터는 Media Session의 제목·아티스트·아트워크를 우선 읽고 플랫폼별 최소 DOM fallback을 사용한다. 사장님이 오른쪽 화면에서 곡을 직접 바꿔도 리더 소켓이 `playback_state.track`으로 전달한다. 손님 화면은 이 값을 DB 신청곡보다 우선 표시하고, 감지 실패 시 기존 `playing` 신청곡으로 되돌아간다.
- 서버는 제목 길이·플랫폼·썸네일 host를 allowlist로 제한하고 계정·세션·원본 페이지 URL은 손님에게 전달하지 않는다.
- 기본 BGM 화면에서 사장님이 직접 고른 곡은 감지 즉시 UUID 재생 세션을 만들고 `playback_state.track`에 세션 댓글 키와 확인된 곡 ID를 포함한다. 신청곡 `playing`과 별개이며 추천·TOP 통계에 넣지 않는다.
- 직접 재생곡은 정상 종료 시 재생 시간과 무관하게, 다른 곡으로 바뀌면 60초 이상일 때만 `playback_history`에 저장한다. 60초 미만 탐색 재생도 이미 작성된 댓글은 보존하고, 실제 곡 ID가 확인되면 세션 댓글 키를 곡 ID로 병합한다.

## 재생 리더와 시작 확인

- Electron renderer는 앱 실행 세션 동안 유지되는 UUID를 소켓 handshake에 보낸다.
- 서버는 카페별 첫 재생 가능 세션을 리더로 선출하고 `playback_role`을 보낸다.
- 리더 연결이 끊기면 같은 세션의 재연결을 15초 기다린 뒤 follower를 승격한다.
- renderer reload로 같은 세션이 돌아오면 진행 중인 `playing`을 초기화하지 않는다. 완전히 새 리더가 선출된 경우에만 남은 `playing`을 `accepted`로 복구한다.
- 서버 프로세스만 재시작된 경우 메인 프로세스의 실제 재생 모드를 확인한다. 같은 실행 세션에서 신청곡이 계속 재생 중이면 DB `playing`을 유지하고 registry만 ACK한다.
- 복구 필요 상태는 DB 복구 성공 ACK 전까지 유지한다. API·소켓 오류로 ACK하지 못하면 같은 리더가 재시도한다.
- 브라우저나 follower가 보낸 `playback_state`는 서버가 무시한다.

재생 시작은 `playRec` 확인 응답이 먼저다. `{ ok: true }`는 음원이 이미 소리 난다는 뜻이 아니라 URL 검증과 navigation을 Electron이 수락했다는 뜻이다. 이 응답 뒤에만 renderer가 DB를 `playing`으로 바꾸고, DB 갱신이 실패하면 `endRec`으로 되돌린다. 원격 owner SPA가 설치본보다 먼저 배포될 수 있으므로 preload는 `supportsPlayRecAck` capability를 함께 노출한다. 이 값이 없는 기존 설치본은 기존 send 방식으로 동작한다.

## 실패와 복구

- Electron이 navigation을 거절하거나 실패하면 DB를 `playing`으로 바꾸지 않는다. 두 곡을 동시에 `playing`으로 만들지 않는다.
- 자동재생과 드래그 재생은 하나의 renderer 전환 잠금을 공유한다. 전환 중 들어온 다른 시작 요청은 거절해 navigation과 DB 갱신 순서가 엇갈리지 않게 한다.
- 재생 중인 곡을 덮어쓰지 않는다. 현재 곡을 먼저 종료한 뒤 다음 곡을 시작한다.
- 종료 이벤트가 중복돼도 종료 상태를 다시 활성 상태로 되돌리지 않는다.
- 앱 종료 전 현재 재생곡을 종료 상태로 정리한다. 로그아웃도 현재 리더의 `playing`과 실제 플레이어를 함께 정리하고, HTTP 정리가 실패하면 실행 세션 ID를 폐기해 다음 리더가 고아 상태를 복구하게 한다.
- BGM 복구 실패는 신청곡 큐 상태와 분리해 다룬다. 기본 BGM 해제는 뷰뿐 아니라 takeover 복구용 URL·메타데이터도 함께 비운다.
- 신청곡 재생 중에는 기본 BGM 설정·해제·드래그를 잠근다. 메인 프로세스도 같은 조건을 검사해 takeover의 `bgmView`가 교체되지 않게 한다.
- 기본 BGM 설정·해제는 Electron ACK(`supportsBgmAck`) 성공 뒤에만 React 상태와 localStorage에 반영한다. 비동기 메타데이터 조회 중 신청곡이 시작되면 변경을 거절한다.
- 기본 BGM은 변경 가능한 slug가 아니라 카페 ID별 localStorage에 보관한다. 로그아웃은 인증 정보만 제거하며 같은 카페로 다시 로그인하면 복구한다.

상태 전이 규칙은 [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md#recommendation-status-contract)를 따른다.

## 구현 위치

```text
owner/electron/main.js                            앱 준비·종료 수명주기 조율
owner/electron/window-manager.js                  BrowserWindow·BrowserView 배치
owner/electron/panel-layout.js                    패널 비율·접힘 계산
owner/electron/playback-controller.js             BGM·신청곡 모드와 IPC 오케스트레이션
owner/electron/end-detection.js                   Spotify·SoundCloud 시그니처 종료 감지
owner/electron/playback-state.js                  플랫폼 공통 실시간 재생 상태 감지
owner/electron/navigation-policy.js               허용 URL과 navigation 판정
owner/electron/web-preferences.js                 WebContents 보안 옵션
owner/electron/platform-adapters/spotify.js       Spotify 재생·takeover 복구
owner/electron/platform-adapters/soundcloud.js    SoundCloud 모달 제거·실제 클릭
owner/electron/platform-adapters/current-track.js 현재 곡 메타데이터 감지
owner/electron/session-tools.js                   세션 초기화·쿠키 import·요청 정책
owner/electron/auto-update.js                     electron-updater 이벤트와 재시작
owner/electron/preload.js                         안전한 renderer API
owner/electron/stealth-preload.js                 외부 플랫폼 호환 처리
owner/electron/youtube-preload.js                 YouTube 종료 이벤트
owner/src/pages/dashboard/                        큐 UI와 Electron 이벤트 소비
```

변경 원칙:

- `main.js`에 플랫폼별 DOM 로직을 다시 넣지 않는다.
- 창 배치는 `window-manager.js`, 재생 순서는 `playback-controller.js`에서 처리한다.
- 외부 플랫폼 셀렉터와 클릭은 해당 어댑터 안에 둔다.
- 종료 감지 임계값과 polling 정리는 `end-detection.js`에서 관리한다.
- 구조 변경과 실제 재생 정책 변경은 별도 커밋으로 나눈다.
