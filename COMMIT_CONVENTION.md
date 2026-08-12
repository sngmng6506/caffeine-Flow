# 커밋 메시지 컨벤션

AI 도구(Claude Code, Codex, Gemini 등)와 협업하는 모든 커밋에 적용한다.
커밋은 "무엇을"이 아니라 **"왜"와 "어떤 판단을"** 기록하는 문서다.

## 형식

```
<type>(<scope>): <제목 — 한국어, 명사형/간결하게>

Why: <이 변경이 필요했던 배경·문제·요청. 1~3문장>

- <파일/모듈>: <변경 내용 요약>
- <핵심 구현 포인트 — 알고리즘, 자료구조, 파라미터 등>
- <테스트 추가 여부>

Decision: <여러 선택지 중 이 방식을 택한 이유. 기각한 대안과 근거를 함께>

🤖 Generated with Claude Code
```

## 규칙

1. **type**: `feat` `fix` `refactor` `perf` `docs` `test` `chore` `style` `ci`
2. **scope**: 변경 영역 — 이 저장소에서는 `server` `customer` `owner` `electron` `db` `security` `ui` 등
3. **Why: 필수.** 코드 diff는 "무엇"을 보여주지만 "왜"는 커밋에만 남는다.
   요청 배경, 재현된 버그, 사용자 피드백을 적는다.
4. **본문 bullet**: 변경 파일/모듈 단위로. 자잘한 나열보다 핵심 구현 판단 위주.
5. **Decision: 선택지가 있었던 경우 필수.** 기각한 대안("A 대신 B — 이유")을
   명시해서 미래의 리뷰어(사람이든 AI든)가 같은 고민을 반복하지 않게 한다.
   단순 오타 수정처럼 판단이 없었던 커밋은 생략 가능.
6. **🤖 Generated 마커**: AI가 생성/주도한 커밋에 항상 붙인다.
   사용 도구에 따라 `Claude Code` / `Codex` / `Gemini` 등으로 표기.
7. **논리적 변경 1개 = 커밋 1개.** 보안 수정 + UI 수정을 한 커밋에 섞지 않는다.
8. 제목은 72자 이내, 본문은 자연 줄바꿈.

## CI 검사

`.github/workflows/ci.yml`의 `commit-message` job이 신규 커밋 메시지를 검사한다.

검사 범위:

```txt
push        → github.event.before..github.sha
pull_request → base.sha..head.sha
```

즉, 과거 전체 히스토리를 검사하지 않고 이번 push 또는 PR에 포함된 신규 커밋만 검사한다.
기존 main에 이미 들어간 비준수 커밋을 고치려면 로컬에서 `git rebase -i` 또는 `git filter-repo`로 history를 rewrite한 뒤 force-push해야 한다.

검사 스크립트:

```txt
.github/scripts/validate-commit-messages.mjs
```

자동 merge/revert 커밋은 검사에서 제외한다.

`pull_request` 실행에서 PR 내부 커밋을 먼저 검사하므로, GitHub가 squash merge 뒤
`main` push에 생성한 `... (#PR번호)` 형식의 단일 커밋은 중복 검사에서 제외한다.
일반 직접 push 커밋은 기존 본문 규칙을 그대로 적용한다.
