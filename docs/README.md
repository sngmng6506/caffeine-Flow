# 문서 안내

Caffeine Flow 문서는 **한 사실을 한 문서에서만 자세히 설명한다.** 다른 문서는 한 문장 요약과 링크만 둔다.

AI는 모든 문서를 읽지 않는다. 작업별 필수 문서와 갱신 조건은 [AGENTS.md](../AGENTS.md)가 기준이고, 각 기준 문서 제목 아래의 `AI가 읽을 때`·`함께 갱신할 때`·`생략 가능한 경우`가 개별 판단 기준이다.

## 문서별 단일 책임

| 문서 | 담당하는 단 하나의 질문 |
| --- | --- |
| [../README.md](../README.md) | 이 제품은 무엇이고 어떻게 실행하나 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 시스템 경계와 데이터 흐름은 어떤가 |
| [PLAYBACK.md](PLAYBACK.md) | Electron이 외부 음악을 어떻게 재생하나 |
| [API.md](API.md) | 지금 존재하는 엔드포인트는 무엇인가 |
| [../admin/README.md](../admin/README.md) | 플랫폼 운영자 콘솔의 화면과 API 경계는 무엇인가 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 어떻게 실행·검증·배포하나 |
| [LLM_FILTER.md](LLM_FILTER.md) | AI 음악 필터는 현재 어떻게 동작하나 |
| [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md) | 무엇을 깨뜨리면 안 되나 |
| [ROADMAP.md](ROADMAP.md) | 아직 구현하지 않은 후보는 무엇인가 |
| [DOCUMENTATION_POLICY.md](DOCUMENTATION_POLICY.md) | 문서를 어떻게 쓰고 나누나 |
| [../COMMIT_CONVENTION.md](../COMMIT_CONVENTION.md) | 커밋을 어떻게 쓰나 |
| [../customer/DESIGN_GUIDE.md](../customer/DESIGN_GUIDE.md) | 손님 화면의 시각·컴포넌트 기준은 무엇인가 |
| [../customer/WRITING_GUIDE.md](../customer/WRITING_GUIDE.md) | 손님 화면의 목소리·용어·문구 기준은 무엇인가 |
| [../owner/DESIGN_GUIDE.md](../owner/DESIGN_GUIDE.md) | 사장님 화면의 시각·컴포넌트 기준은 무엇인가 |
| [../owner/WRITING_GUIDE.md](../owner/WRITING_GUIDE.md) | 사장님 화면의 목소리·용어·문구 기준은 무엇인가 |

## 섞지 않는 것

- 현재 동작 문서에 미래 계획을 넣지 않는다.
- API 레퍼런스에 설계 배경을 길게 넣지 않는다.
- 가드레일에 기능 설명을 복사하지 않는다.
- 환경변수 목록과 상태표를 문서마다 반복하지 않는다.
- 내부 리팩터링만으로 불필요한 문서 변경을 만들지 않는다.
