# 아키텍처

> **AI가 읽을 때:** 시스템 경계, 앱별 책임, 데이터 흐름, 인증 경계, 추천곡 상태 모델을 변경할 때
> **함께 갱신할 때:** 컴포넌트 책임·상태 전이·영속 상태의 단일 원천이 달라질 때
> **생략 가능한 경우:** 기존 경계 안에서 함수·컴포넌트만 분리하는 내부 리팩터링

코드를 읽기 전에 시스템 경계와 데이터 흐름을 파악하기 위한 문서다. 재생 엔진은 [PLAYBACK.md](PLAYBACK.md), API 경로는 [API.md](API.md), AI 필터는 [LLM_FILTER.md](LLM_FILTER.md), 개발·배포는 [DEVELOPMENT.md](DEVELOPMENT.md)를 따른다.

## 시스템 구성

```mermaid
flowchart LR
    G["손님 모바일 웹"] -->|"신청·투표·댓글"| S
    O["사장님 React/Electron"] -->|"큐 관리·재생 상태"| S
    A["플랫폼 운영자 콘솔"] -->|"카페 모니터링·관리"| S

    subgraph Railway
        S["Express + Socket.IO"] --- DB[("PostgreSQL")]
    end

    S -->|"트랙 메타데이터"| MUSIC["YouTube · SoundCloud · Spotify"]
    S -->|"곡 심사"| LLM["OpenRouter LLM"]
    S -->|"사장님 로그인"| OAUTH["Google · Naver"]
```

손님과 사장님 앱은 직접 통신하지 않는다. 모든 상태 변경은 서버에 저장된 뒤 카페별 Socket.IO room으로 전파된다.

## 애플리케이션 경계

| 영역 | 책임 |
| --- | --- |
| `customer/` | 손님용 SPA. 신청·투표·댓글·큐 조회 |
| `owner/src/` | 사장님 UI. 큐 상태 전이와 운영 설정 |
| `owner/electron/` | 창 관리, 실제 음악 재생, 종료 감지 |
| `admin/` | 운영자용 카페 모니터링·정지·삭제와 AI 랩 진입 |
| `music-filter-lab/` | 모델·프롬프트별 필터 판단을 저장 없이 비교하는 운영자 UI |
| `music-labeling-lab/` | 전체 카페 AI 처리 이력을 한 큐에서 골드 라벨링하는 운영자 UI |
| `server/` | 인증, 검증, 영속화, 실시간 이벤트, 통계, AI 판단 |

서버는 판단과 데이터 일관성을, Electron은 실제 외부 플랫폼 재생을 책임진다. 여러 사장님이 접속해도 서버가 카페별 재생 리더 Electron 한 대를 정한다. 리더 선출·재연결 lease·재생 시작 확인 순서는 [PLAYBACK.md](PLAYBACK.md)가 기준이다.

## 신청곡 흐름

```mermaid
sequenceDiagram
    participant G as 손님
    participant S as 서버
    participant A as AI 필터
    participant O as 사장님 앱

    G->>S: 음악 링크 메타데이터 확인
    S-->>G: 정규화 메타데이터 + 단기 서명 토큰
    G->>S: 서명 토큰으로 신청
    S->>S: 카페·서명·플랫폼·중복·한도 검증
    opt AI 필터 ON
        S->>A: 매장 정책과 곡 메타데이터 전달
        A-->>S: accept / reject
    end
    S->>S: 신청곡과 판단 결과 저장
    S-->>G: 접수 또는 거절 응답
    S-->>O: owner_recommendations_update
    S-->>G: recommendations_update
    O->>S: accepted / playing / played 상태 전이
```

LLM이 `accept`해도 일반 큐 상태는 `pending`이다. 자동수락과 실제 재생 전환은 사장님 앱이 처리한다.

## Recommendation Status Contract

```mermaid
stateDiagram-v2
    [*] --> pending : 손님 신청
    [*] --> rejected : AI 또는 사장님 거절

    pending --> accepted : 사장님 수락
    accepted --> pending : 대기로 되돌림
    accepted --> playing : 재생 시작
    playing --> accepted : 재생 취소

    playing --> played : 정상 종료
    playing --> skipped : 스킵

    played --> [*]
    skipped --> [*]
    rejected --> [*]
```

- 활성 상태는 `pending`, `accepted`, `playing`이고 종료 상태는 `played`, `skipped`, `rejected`다.
- 종료 상태는 다시 활성 상태로 돌리지 않는다.
- 같은 카페·같은 곡은 활성 상태로 동시에 두 개 존재할 수 없다.
- 활성 큐는 신청 시각과 관계없이 모두 노출하며 목록·한도·중복이 같은 범위를 사용한다.
- 허용 상태값과 전이 범위는 `server/src/constants/recommendation-status.js`와 서버 상태 전이 정책이 기준이다.

변경 시 [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md#recommendation-status-contract)를 먼저 확인한다.

## 실시간 동기화

카페별 공용 room과 인증된 사장님 전용 `owner:<slug>` room을 사용한다.

```text
손님 추가·투표·취소
→ 서버 트랜잭션
→ DB 반영
→ recommendations_update (공개 allowlist)
→ owner_recommendations_update (인증된 사장님 전용)
→ 손님·사장님 화면 갱신
```

- DB 상태가 단일 원천이다. 재연결 시 클라이언트는 현재 큐를 다시 조회하며 소켓 이벤트만으로 영구 상태를 복원하지 않는다.
- 공용 재생 상태는 인증만으로 발행할 수 없고 카페별 재생 리더여야 한다.
- AI 판단 상세와 필터 오류는 사장님 room으로만 보낸다.
- 공개 응답과 공용 이벤트는 DB row 전체가 아니라 `server/src/utils/public-response.js`의 허용 필드만 직렬화한다.
- 정지되거나 존재하지 않는 카페는 손님 HTTP 요청과 소켓 입장을 모두 차단한다. 검증된 사장님 연결은 운영 복구를 위해 유지할 수 있다.

## 인증 경계

| 주체 | 자격 | 비고 |
| --- | --- | --- |
| 사장님 | Google/Naver 로그인 후 JWT | 운영자 토큰과 같은 권한으로 취급하지 않는다 |
| 신규 가입 | 제한시간이 있는 pending token | 가입 완료 전용 |
| 운영자 | `role=admin` 전용 토큰 | 별도 미들웨어 |
| 손님 | 계정 없이 `visitor_id` + IP | 사람이나 기기의 고유 식별자가 아니다 |

- 사장님 권한은 JWT의 불변 `cafeId`로 카페를 조회한 뒤 현재 slug까지 일치할 때만 부여한다. 옛 slug가 다른 카페에 재사용되어도 옛 토큰은 새 소유자의 데이터와 owner room에 접근할 수 없다.
- 손님 취소는 `visitor_id` 일치가 필수다. 투표·방문 중복 제거는 `visitor_id`를 우선하고 값이 없는 레거시 요청만 IP로 fallback한다.

## 데이터 모델

| 테이블 | 역할 |
| --- | --- |
| `cafes` | 카페 계정, slug, 운영 설정, AI 필터 정책, 저장된 손님용 신청곡 안내, 하트비트 |
| `recommendations` | 신청곡, 일반 상태, AI 판단, 신청·재생 시각 |
| `music_filter_prompt_history` | 매장 분위기 설명 변경 이력. `baseline`과 `changed`를 구분 |
| `music_filter_reviews` | AI 판단과 분리된 운영자 골드 라벨, 사유 코드, 선택적 메타데이터 충분 여부 |
| `music_track_annotations` | 플랫폼 원본 곡별 수동 음악 특성 라벨. 정규화 아티스트 키로 참고 조회 |
| `votes` | 곡별 투표와 중복 방지 |
| `comments` | 개별 신청곡 댓글 |
| `song_comments` | 같은 곡을 카페 간 공유하는 댓글과 답글 |
| `playback_history` | 사장님이 브라우저에서 직접 재생한 유효 곡 이력. 신청곡 통계와 분리 |
| `cafe_visits` | 카페·visitor ID·KST 날짜 기준 익명 브라우저 집계 |
| `daily_stats` | KST 기준 운영 통계와 피크 동시접속 |
| `cafe_slug_history` | QR slug 변경 이력과 이전 주소 이동 안내 |

`recommendations.id`는 UUID다. 순서를 가정한 `MIN/MAX(id)` 집계는 사용하지 않는다.

## 시간 기준

사용자에게 보이는 날짜·이력·통계의 하루 경계는 KST다. 서버와 사장님 UI는 공통 KST 유틸을 사용하며 UTC 자정을 직접 계산하지 않는다.

## 배포 경계

- 서버와 두 SPA: Railway 단일 서비스
- PostgreSQL: Railway 연결 DB
- Electron 설치 파일: GitHub Release

명령과 환경변수는 [DEVELOPMENT.md](DEVELOPMENT.md), Electron 업데이트 동작은 [PLAYBACK.md](PLAYBACK.md)를 참고한다.
