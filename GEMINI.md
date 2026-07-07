# GEMINI.md

이 저장소의 공통 협업 계약은 `AGENTS.md`에 있다. **먼저 읽고 따른다.**
(Gemini는 @import 자동 로드를 보장하지 않으므로, 세션 시작 시 AGENTS.md를 직접 읽을 것.)

GEMINI.md는 그 계약에 Gemini 특화 지침만 얇게 얹는 어댑터다. 규칙을 여기서 중복하지 않는다.

---

## Gemini 특화

- **한국어로 응답한다.** 코드 주석·커밋도 한국어, 식별자는 영어.
- **변경 전 관련 파일을 읽는다.** 라우트·서비스·마이그레이션을 확인하고 추측하지 않는다.
- **단계별로 작게.** 각 단계마다 `node --check`·테스트로 검증.
- 파괴적 변경(스키마·삭제)은 먼저 확인받는다.

## 자주 쓰는 명령

```bash
npm run test:unit --prefix server        # 빠른 확인
npm test --prefix server                 # 통합 포함 (Postgres 필요)
npm run migrate --prefix server          # 마이그레이션
cd owner && npm run build                # owner 번들 리빌드 (수정 후 필수)
```

## 반드시 지킬 것 (계약 요약 — 상세는 AGENTS.md)

- 공유 DB에 로컬 마이그레이션 실행 금지
- 사용자 URL fetch는 safeAxiosGet 경유 (SSRF)
- recommendations.id는 UUID — 집계에 MIN/MAX(id) 금지
- owner 소스 수정 후 번들 리빌드 커밋
- 커밋은 COMMIT_CONVENTION.md 형식
