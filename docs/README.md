# 문서 안내

Caffeine Flow 문서는 **한 사실을 한 문서에서만 자세히 설명한다.** 다른 문서에서는 짧게 요약하고 기준 문서로 연결한다.

AI는 모든 문서를 한꺼번에 읽지 않는다. 작업 종류별 필수 문서와 갱신 조건은 루트 [AGENTS.md](../AGENTS.md)가 기준이다. 각 기준 문서 제목 아래에는 `AI가 읽을 때`, `함께 갱신할 때`, `생략 가능한 경우`가 표시된다.

## 처음 읽기

| 목적 | 문서 |
| --- | --- |
| 제품과 실행 방법 파악 | [프로젝트 README](../README.md) |
| 전체 시스템 이해 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Electron 재생 동작 이해 | [PLAYBACK.md](PLAYBACK.md) |
| API 경로 확인 | [API.md](API.md) |
| 로컬 개발·환경변수·배포 | [DEVELOPMENT.md](DEVELOPMENT.md) |
| AI 음악 필터 이해 | [LLM_FILTER.md](LLM_FILTER.md) |
| 미구현 개선 후보 | [ROADMAP.md](ROADMAP.md) |

## 코드를 수정할 때

| 작업 | 먼저 읽을 문서 |
| --- | --- |
| 모든 작업의 시작과 문서 선택 | [AGENTS.md](../AGENTS.md) |
| 상태·라우터·시간·SQL·LLM 변경 | [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md) |
| 커밋 작성 | [COMMIT_CONVENTION.md](../COMMIT_CONVENTION.md) |
| 문서 추가·재구성 | [DOCUMENTATION_POLICY.md](DOCUMENTATION_POLICY.md) |

## 문서별 단일 책임

- `ARCHITECTURE.md`: 시스템 경계와 데이터 흐름
- `PLAYBACK.md`: Electron과 외부 음악 플랫폼
- `API.md`: 현재 존재하는 엔드포인트
- `DEVELOPMENT.md`: 실행·검증·배포 방법
- `LLM_FILTER.md`: 현재 구현된 AI 판단 동작
- `AI_CHANGE_GUARDRAILS.md`: 반드시 유지해야 하는 코드 계약
- `ROADMAP.md`: 아직 구현되지 않은 후보

다음 내용은 섞지 않는다.

- 현재 동작 문서에 미래 계획을 넣지 않는다.
- API 레퍼런스에 설계 배경을 길게 넣지 않는다.
- 가드레일에 기능 설명을 복사하지 않는다.
- 환경변수 목록을 기능 문서마다 반복하지 않는다.
- 내부 리팩터링만으로 불필요한 문서 변경을 만들지 않는다.
