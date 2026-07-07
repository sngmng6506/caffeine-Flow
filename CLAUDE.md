# CLAUDE.md

이 저장소의 공통 협업 계약은 아래 파일에 있다. **먼저 읽고 따른다.**

@AGENTS.md

CLAUDE.md는 위 계약에 Claude Code 특화 지침만 얇게 얹는 어댑터다. 규칙을 여기서 중복하지 않는다 (계약이 바뀌면 AGENTS.md만 고친다).

---

## Claude Code 특화

- **한국어로 응답한다.** 코드 주석·커밋도 한국어, 식별자는 영어 (AGENTS.md의 저장소 규칙과 동일).
- **단계별 구현 + 각 단계 검증.** 큰 변경을 한 번에 쏟지 말고, 논리 단위로 나눠 `node --check`·테스트로 확인하며 진행한다.
- **가정이 틀리면 즉시 수정.** 사용자가 방향을 바로잡으면 변명 없이 반영한다.
- 명확히 하기 위한 질문은 영어로 해도 된다.

## 자주 쓰는 명령 (verbatim)

```bash
npm run test:unit --prefix server        # 빠른 확인 (DB 불필요)
npm test --prefix server                 # 통합 포함 (Postgres 필요)
npm run migrate --prefix server          # 마이그레이션
cd owner && npm run build                # owner 번들 리빌드 (수정 후 필수)
node --check <file>                      # 커밋 전 구문 검사
```

## 검증 체크리스트 (커밋 전)

- [ ] `node --check` 통과
- [ ] 로직 변경이면 관련 테스트 통과
- [ ] 마이그레이션/DB 변경이면 실제 스키마(UUID PK 주의)로 검증
- [ ] `owner/src` 수정 시 번들 리빌드 포함
- [ ] 커밋 메시지가 COMMIT_CONVENTION.md 형식
