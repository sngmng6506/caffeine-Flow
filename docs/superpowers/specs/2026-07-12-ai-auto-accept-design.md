# AI 자동수락 통합 설계

날짜: 2026-07-12 · 승인: 사장님(사용자) 대화로 확정

상태: 구현 완료. 현재 동작의 단일 기준은 [AI 음악 필터](../../LLM_FILTER.md)다. 이 문서는 당시 설계 결정 기록으로 보존한다.

## 배경

사장님 앱에 성격이 겹치는 토글이 두 개 있어 UX가 혼란스럽다.

- **자동 수락** (대시보드 헤더 버튼): 새 신청곡을 무조건 자동 수락·재생. 기기별 localStorage(`cf_auto_accept`).
- **AI 음악 필터** (설정 탭): 서버에서 LLM이 신청곡을 accept/reject 판단. 카페별 DB(`music_filter_enabled`). 단, accept여도 `pending`이라 사장님이 또 수락해야 함.

"AI가 심사했는데 왜 또 수락하나"가 문제. 두 토글을 하나의 **AI 자동수락**으로 통합한다.

## 결정 사항

1. **ON의 의미**: AI 필터 판단(서버) → 통과곡만 대시보드가 자동 수락·재생.
2. **OFF의 의미**: AI 필터도 함께 꺼짐. 전부 `pending`으로 들어와 수동 운영.
3. AI 없이 무조건 받는 옛 자동수락 모드는 제거한다.

## 설계

### 상태의 원천

서버 `cafes.music_filter_enabled` 하나로 통일. `cf_auto_accept` localStorage 제거.
부수 효과: 멀티 기기에서 상태 일관.

### 대시보드 (`owner/src/pages/DashboardPage.jsx`)

- 버튼 텍스트 `자동 수락` → `AI 자동수락`.
- 마운트 시 `getMe()`로 `music_filter_enabled` 로드해 초기화.
- **ON 클릭**: `getMe()`로 최신 프롬프트 조회 → 프롬프트 없으면 안내(alert)하고 켜지 않음 → 있으면 `updateMusicFilter({ enabled: true, prompt })` 저장 후 기존 pending 일괄 수락 + 재생 시작(기존 동작 유지).
- **OFF 클릭**: 최신 프롬프트를 유지한 채 `enabled: false` 저장.
- socket `add` 핸들러의 자동 수락 판단은 이 서버 상태 ref로 대체.

### 설정 탭 (`owner/src/pages/dashboard/MusicFilterSettings.jsx`)

- ON/OFF 토글 제거. 프롬프트 + AI 테스트만 남김.
- 설명 문구를 "대시보드의 AI 자동수락에 사용됩니다"로 조정.
- **stale enabled 방지**: 저장 직전 `getMe()`로 최신 `music_filter_enabled`를 읽어 그 값을 그대로 전송(설정 탭이 필터를 켜고 끄는 일이 없도록).
- 서버 enabled=true 상태에서 프롬프트를 비워 저장하는 것은 차단(경고 표시).

### 서버·계약

변경 없음. `PUT /cafes/me/music-filter` 시그니처, 상태 계약(LLM accept→`pending`, fail-closed), 손님 화면 모두 그대로.

### 문서

당시 `docs/LLM_FEATURES.md`의 "AI 필터 ON/OFF" 설명을 대시보드 AI 자동수락 기준으로 갱신했다. 이후 그 문서는 [LLM_FILTER.md](../../LLM_FILTER.md)로 통합됐다.

## 알려진 한계(수용)

- 데스크톱 2대 동시 운영 시 둘 다 자동 수락을 시도할 수 있음 — 실운영 1대 전제, 대응하지 않음.
- 다른 기기에서 토글 변경 시 이 기기는 새로고침 전까지 모름(socket 전파 없음) — 동일 전제로 수용.

## 검증

- `npm run build --prefix owner` 통과.
- dev 실행으로 토글 ON(프롬프트 유무 두 경우)·OFF, 신청곡 자동 수락 흐름 수동 확인.
- 서버 테스트는 무변경이므로 회귀 없음 확인만.
