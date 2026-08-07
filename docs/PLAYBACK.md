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
- 사용자 입력 URL은 서버 검증을 거친 결과만 재생한다.
- 외부 페이지 DOM 조작은 플랫폼별 어댑터 경계 안에 둔다.
- 로그인 정보와 토큰을 로그에 남기지 않는다.

## 이벤트 계약

렌더러가 사용하는 주요 Electron 이벤트:

```text
playRec          신청곡 재생
endRec           신청곡 종료 처리 및 BGM 복귀
setBgmUrl        기본 BGM 설정
clearBgm         기본 BGM 해제
onVideoEnded     신청곡 종료 알림
onNowPlaying     현재 재생 정보
onWidevineStatus Widevine 상태
setPanelRatio    렌더러/BrowserView 경계 조정
```

정확한 채널명과 payload는 `owner/electron/preload.js`와 `owner/electron/main.js`가 기준이다.

## 실패와 복구

- 앱 시작 시 서버에 남은 `playing` 상태는 `accepted`로 복구한다.
- 신청곡 재생 실패 시 두 곡을 동시에 `playing`으로 만들지 않는다.
- 종료 이벤트가 중복되어도 종료 상태를 다시 활성 상태로 되돌리지 않는다.
- 앱 종료 전 현재 재생곡을 종료 상태로 정리한다.
- BGM 복구 실패는 신청곡 큐 상태와 분리해 다룬다.

상태 전이 규칙은 [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md)의 Recommendation Status Contract를 따른다.

## 구현 위치

```text
owner/electron/main.js             창·재생 오케스트레이션
owner/electron/preload.js          안전한 renderer API
owner/electron/stealth-preload.js  외부 플랫폼 호환 처리
owner/electron/youtube-preload.js  YouTube 종료 이벤트
owner/src/pages/dashboard/         큐 UI와 Electron 이벤트 소비
```

`owner/electron/main.js`를 분리할 때 권장 경계:

```text
window-manager
playback-controller
platform-adapters/youtube
platform-adapters/spotify
platform-adapters/soundcloud
update-manager
```

분리는 동작 변경과 섞지 않고 플랫폼 하나씩 검증한다.
