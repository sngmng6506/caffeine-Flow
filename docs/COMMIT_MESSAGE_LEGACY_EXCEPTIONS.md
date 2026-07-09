# Commit Message Legacy Exceptions

이 문서는 `COMMIT_CONVENTION.md` 도입·강화 전에 main에 들어간 비준수 커밋을 추적한다.

현재 CI의 `commit-message` job은 과거 전체 히스토리를 검사하지 않고, `push` 또는 `pull_request` 이벤트에 포함된 **신규 커밋 범위만** 검사한다. 따라서 아래 커밋들은 rewrite/amend 대상이 아니라 기록용 예외다.

## 판단 기준

비준수 기준:

```txt
<type>(<scope>): <제목>

Why: ...

- ...

Decision: ...

🤖 Generated with Codex
```

위 형식에서 scope, Why, bullet, Decision, Generated marker 중 하나 이상이 빠진 경우를 legacy exception으로 본다.

## 최근 확인된 예외

아래 목록은 이번 AI 정리 작업 중 확인 가능한 SHA와 기억 가능한 제목 기준이다. GitHub 커넥터 환경에서 `git log` 전체를 직접 열람하지 못했기 때문에 완전한 전체 목록은 아니며, 최근 작업 구간의 known bad commit 목록으로 관리한다.

| Commit | 기억나는 제목/내용 | 위반 내용 |
| --- | --- | --- |
| `c3dea0bccbb5233fc36147d9eca271b4641171c2` | `test: preserve owner-added recommendation platform` | scope 없음, Why/Decision/Generated 본문 없음 |
| `5311a5686be4bc62d73693a890a25e5cfb042aae` | `test: lock music filter strictness policy` 계열 | scope 없음, Why/Decision/Generated 본문 없음 |
| `cb1a04adfb1de334bbb68cbdee3bb3fabc78c083` | owner/customer platform constants 정리 | scope 없음 또는 본문 컨벤션 미준수 |
| `7222df370fd98eaab08eb9bb49368ea9f5f46f18` | owner/customer status constants 정리 | scope 없음 또는 본문 컨벤션 미준수 |
| `d9f701cf56e15b17a227f85fde72940aaff87a0f` | `customer/src/pages/CafePage.jsx` 상태 상수 적용 | 본문 컨벤션 미준수 |
| `3bc838f8a408f0bd2629665d7b91b159b28aa09d` | `owner/src/pages/DashboardPage.jsx` 상태 상수 적용 | 본문 컨벤션 미준수 |

## 운영 방침

- 위 커밋들은 과거 기록으로 보존한다.
- main 히스토리를 rewrite하지 않는다.
- 앞으로 들어오는 커밋은 CI의 `commit-message` job이 `COMMIT_CONVENTION.md` 형식을 강제한다.
- 예외 목록은 새로 발견된 과거 비준수 커밋을 문서화할 때만 갱신한다.
