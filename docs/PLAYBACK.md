# 재생 엔진

> **AI가 읽을 때:** Electron, BrowserView, BGM·신청곡 재생, 종료 감지, 플랫폼 DOM 우회, IPC를 수정할 때
> **함께 갱신할 때:** overlay/takeover, 플랫폼별 재생·복구 방식, 종료 신호, preload 계약이 달라질 때
> **생략 가능한 경우:** 재생과 무관한 일반 React UI·서버 API만 수정할 때

이 문서는 사장님 Electron 앱의 재생 구조와 플랫폼별 제약을 설명한다. 전체 시스템 경계는 [ARCHITECTURE.md](ARCHITECTURE.md), 로컬 실행과 배포 명령은 [DEVELOPMENT.md](DEVELOPMENT.md)를 참고한다.

## 역할

사장님 앱은 매장 BGM을 유지하면서 신청곡을 잠시 재생한 뒤 원래 BGM으로 돌아온다.

```text
bgmView  매장 기본 BGM
recView  신청곡 임시 재생
```

렌더러는 큐 상태와 사용자 조작을 관리하고, Electron 메인 프로세스는 창 배치·플랫폼 재생·종료 감지를 담당한다.
같은 카페에 여러 사장님 화면이 연결돼도 서버가 선출한 Electron 한 대만 실제
재생과 재생 상태 발행을 담당한다. 일반 브라우저와 나머지 Electron은 큐를 볼 수
있지만 재생 조작은 수행하지 않는 follower다.

## 재생 모드

### Overlay

대부분의 조합은 두 BrowserView를 사용한다.

```text
BGM 재생
→ BGM 음소거
→ recView에서 신청곡 재생
→ 신청곡 종료
→ recView 정리
→ BGM 음소거 해제
```

### Spotify takeover

BGM과 신청곡이 모두 Spotify이면 같은 계정의 재생 세션이 충돌할 수 있어 `bgmView` 안에서 신청곡으로 전환한다.

```text
현재 BGM 트랙·위치 저장
→ 같은 뷰에서 신청곡 재생
→ 종료 감지
→ 기존 트랙·위치 복구
```

## 플랫폼별 처리

| 플랫폼 | 재생 | 종료 감지 |
| --- | --- | --- |
| YouTube | 영상 URL 로드 | `<video>`의 `ended` 이벤트 |
| Spotify | 웹 플레이어/Connect 세션 | 트랙 제목 시그니처 변화 |
| SoundCloud | 웹 플레이어 | 트랙 제목 시그니처 변화 |

Spotify와 SoundCloud는 자체 자동재생으로 다음 곡을 이어갈 수 있어 DOM의 단순 `ended` 신호에 의존하지 않는다. 제목 시그니처가 일정 횟수 연속으로 달라졌을 때 신청곡 종료로 판단한다.

## SoundCloud 제약

SoundCloud는 스크립트로 생성한 클릭을 무시하는 경우가 있어 운영체제 수준 입력을 사용한다. 로그인 모달이나 자동재생 방해 요소는 최소 범위에서 차단한다.

이 우회는 플랫폼 DOM 변경에 민감하다. 수정 시 다음을 확인한다.

- 정상 재생 시작
- 로그인 상태와 비로그인 상태
- 종료 후 BGM 복귀
- 클릭 좌표와 창 크기 변화

## 브라우저 호환성

Electron은 DRM 재생을 위해 CastLabs Electron과 Widevine을 사용한다. preload는 플랫폼 페이지와 렌더러 사이의 최소 이벤트만 노출한다.

외부 페이지 대응 코드는 공격면을 넓히기 쉬우므로 다음 원칙을 지킨다.

- IPC 채널을 임의로 확장하지 않는다.
- 신청곡은 서버가 서명한 메타데이터의 플랫폼·ID만 재생한다.
- 기본 BGM URL은 YouTube·SoundCloud·Spotify HTTPS host allowlist를 통과해야 한다.
- Electron IPC는 사장님 메인 renderer에서 온 이벤트만 처리한다.
- 외부 음악·팝업 WebContents는 Chromium sandbox를 사용한다. YouTube preload는 `contextIsolation`을 켜고, main world 보정이 필요한 Spotify/SoundCloud·로그인 stealth preload만 격리 예외로 둔다.
- 외부 음악 페이지에는 camera/microphone을 포함하는 `media` 권한을 주지 않으며, DRM 권한만 허용된 음악 origin에 한해 부여한다.
- 외부 페이지 DOM 조작은 플랫폼별 어댑터 경계 안에 둔다.
- 로그인 정보와 토큰을 로그에 남기지 않는다.

## 이벤트 계약

렌더러가 사용하는 주요 Electron 이벤트:

```text
playRec          신청곡 URL 검증·화면 navigation 요청. Promise<{ ok, error? }> 반환
endRec           신청곡 종료 처리 및 BGM 복귀
setBgmUrl        기본 BGM 설정. Promise<boolean>으로 적용 여부 반환
clearBgm         기본 BGM 해제. Promise<boolean>으로 적용 여부 반환
isRecActive      Electron 메인의 실제 신청곡 재생 모드 조회
onVideoEnded     신청곡 종료 알림
onNowPlaying     현재 재생 정보
onPlaybackState  재생·일시정지·버퍼링 상태
onCurrentTrack   현재 BrowserView에서 감지한 공개 곡 메타데이터
onWidevineStatus Widevine 상태
setPanelRatio    렌더러/BrowserView 경계 조정
setPanelCollapsed 왼쪽 사장님 화면을 48px 상태 레일로 접거나 복원
```

렌더러 공개 API는 `owner/electron/preload.js`, 메인 프로세스 IPC 처리는 각 책임 모듈이 기준이다.
패널을 접을 때는 `bgmView`와 `recView`를 제거하지 않고 bounds만 변경한다. 접힘 상태는 재시작·renderer reload 시 초기화하며, 마지막으로 사용한 펼친 비율만 로컬에 보존한다.
`on*` 이벤트 구독 함수는 해당 리스너만 제거하는 해제 함수를 반환하며,
컴포넌트 정리 시 다른 화면의 구독을 일괄 삭제하지 않는다.

재생 상태는 추천곡의 DB `playing` 상태와 분리된 실시간 신호다. Electron이
`playing`, `paused`, `buffering`, `unknown` 중 하나를 보내며, 서버는 인증된 사장님
소켓 중 현재 재생 리더의 신호만 카페 룸에 전달한다. 신호가 만료되거나 사장님 앱 연결이 끊기면
`unknown`으로 초기화하고 추천곡의 DB 상태는 변경하지 않는다.

현재 곡 메타데이터는 실제 음향 유무와 분리해 관리한다. Electron은 현재 들리는
BrowserView에서 Media Session의 제목·아티스트·아트워크를 우선 읽고, 플랫폼별 최소
DOM fallback을 사용한다. 사장님이 오른쪽 화면에서 곡을 직접 바꿔도 변경된 메타데이터를
재생 리더 소켓이 `playback_state.track`으로 전달한다. 손님 화면은 이 값을 기존 DB
신청곡보다 우선 표시하며, 감지 실패 시 기존 `playing` 신청곡 정보로 되돌아간다.
서버는 제목 길이·플랫폼·썸네일 host를 allowlist로 제한하고 계정·세션·원본 페이지 URL은
손님에게 전달하지 않는다.

## 재생 리더와 시작 확인

- Electron renderer는 앱 실행 세션 동안 유지되는 UUID를 소켓 handshake에 보낸다.
- 서버는 카페별 첫 재생 가능 세션을 리더로 선출하고 `playback_role`을 보낸다.
- 리더 연결이 끊기면 같은 세션의 재연결을 15초 기다린 뒤 follower를 승격한다.
- renderer reload로 같은 세션이 돌아오면 진행 중인 `playing` 상태를 초기화하지 않는다.
- 완전히 새 리더가 선출된 경우에만 서버에 남은 `playing`을 `accepted`로 복구한다.
- 서버 프로세스만 재시작된 경우 Electron 메인의 실제 재생 모드를 확인한다. 같은
  실행 세션에서 신청곡이 계속 재생 중이면 DB `playing`을 유지하고 registry만 ACK한다.
- 서버는 복구 필요 상태를 DB 복구 성공 ACK 전까지 유지한다. API·소켓 오류로
  ACK하지 못하면 같은 리더가 복구를 재시도한다.
- 브라우저나 follower가 보낸 `playback_state`는 서버가 무시한다.

재생 시작 순서는 `playRec` 확인 응답이 먼저다. `{ ok: true }`는 실제 음원이 이미
소리 나고 있다는 뜻이 아니라 URL 검증과 BrowserView navigation을 Electron이
수락했다는 뜻이다. 이 응답 뒤에만 renderer가 추천곡을 DB `playing`으로 바꾸며,
DB 갱신이 실패하면 `endRec`으로 플레이어를 되돌린다.
원격 owner SPA가 설치본보다 먼저 배포될 수 있으므로 preload는
`supportsPlayRecAck` capability를 함께 노출한다. 이 값이 없는 기존 설치본은
기존 send 방식으로 동작하고, 새 설치본부터 확인 응답을 강제한다.

## 실패와 복구

- 새 재생 리더가 시작될 때 서버에 남은 `playing` 상태는 `accepted`로 복구한다.
- follower·브라우저·renderer reload는 기존 `playing` 상태를 변경하지 않는다.
- Electron이 navigation을 거절하거나 실패하면 DB를 `playing`으로 바꾸지 않는다.
- 신청곡 재생 실패 시 두 곡을 동시에 `playing`으로 만들지 않는다.
- 자동재생과 드래그 재생은 하나의 renderer 전환 잠금을 공유한다. 전환 중 들어온
  다른 시작 요청은 거절해 BrowserView navigation과 DB 갱신 순서가 엇갈리지 않게 한다.
- 재생 중인 곡을 다른 곡으로 즉시 덮어쓰지 않는다. 현재 곡을 먼저 종료한 뒤 다음 곡을 시작한다.
- 종료 이벤트가 중복되어도 종료 상태를 다시 활성 상태로 되돌리지 않는다.
- 앱 종료 전 현재 재생곡을 종료 상태로 정리한다.
- 로그아웃도 현재 리더의 `playing`을 종료하고 실제 플레이어를 정리한다. HTTP
  정리가 실패해도 실행 세션 ID를 폐기해 다음 리더가 고아 상태를 복구하게 한다.
- BGM 복구 실패는 신청곡 큐 상태와 분리해 다룬다.
- 기본 BGM 해제는 뷰뿐 아니라 takeover 복구용 URL·메타데이터도 함께 비운다.
- 신청곡 재생 중에는 기본 BGM 설정·해제·드래그를 잠근다. Electron 메인도 같은
  조건을 검사해 Spotify takeover의 `bgmView`가 중간에 교체되지 않게 한다.
- 기본 BGM 설정·해제는 Electron ACK가 성공한 뒤에만 React 상태와 localStorage에
  반영한다. 비동기 메타데이터 조회 중 신청곡이 시작되면 변경을 거절하고 기존 값을 유지한다.

상태 전이 규칙은 [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md)의 Recommendation Status Contract를 따른다.

## 구현 위치

```text
owner/electron/main.js                         앱 준비·종료 수명주기 조율
owner/electron/window-manager.js               BrowserWindow·BrowserView·패널 배치
owner/electron/playback-controller.js          BGM·신청곡 모드와 IPC 오케스트레이션
owner/electron/end-detection.js                 Spotify·SoundCloud 시그니처 종료 감지
owner/electron/playback-state.js                플랫폼 공통 실시간 재생 상태 감지
owner/electron/platform-adapters/spotify.js     Spotify 재생·takeover 복구
owner/electron/platform-adapters/soundcloud.js  SoundCloud 모달 제거·실제 클릭
owner/electron/platform-adapters/current-track.js 현재 곡 메타데이터 감지
owner/electron/session-tools.js                 세션 초기화·쿠키 import·요청 정책
owner/electron/auto-update.js                   electron-updater 이벤트와 재시작
owner/electron/preload.js                       안전한 renderer API
owner/electron/stealth-preload.js               외부 플랫폼 호환 처리
owner/electron/youtube-preload.js               YouTube 종료 이벤트
owner/src/pages/dashboard/                      큐 UI와 Electron 이벤트 소비
```

변경 원칙:

- `main.js`에 플랫폼별 DOM 로직을 다시 넣지 않는다.
- 창 배치 변경은 `window-manager.js`, 재생 순서 변경은 `playback-controller.js`에서 처리한다.
- 외부 플랫폼 셀렉터와 클릭은 해당 어댑터 안에 둔다.
- 종료 감지 임계값과 polling 정리는 `end-detection.js`에서 관리한다.
- 구조 변경과 실제 재생 정책 변경을 가능하면 별도 커밋으로 나눈다.
