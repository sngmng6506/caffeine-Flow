# AI 음악 필터

> **AI가 읽을 때:** 음악 필터 설정, 프롬프트, 모델 호출, 구조화 출력, 자동수락, 오류 처리를 수정할 때
> **함께 갱신할 때:** LLM 입력·출력, `filter_status`, fail-closed, 자동수락 조건이 달라질 때
> **생략 가능한 경우:** AI 판단과 무관한 일반 큐 UI·재생 UI만 수정할 때

사장님이 작성한 매장 분위기 정책을 기준으로 손님 신청곡을 자동 심사한다. 음악 추천기가 아니라 **부적절한 곡이 매장에 재생되는 위험을 줄이는 운영 안전장치**다.

전체 신청 흐름은 [ARCHITECTURE.md](ARCHITECTURE.md), 엔드포인트는 [API.md](API.md), 변경 금지 계약은 [AI_CHANGE_GUARDRAILS.md](AI_CHANGE_GUARDRAILS.md)를 참고한다.

## 설정

| 필드 | 의미 |
| --- | --- |
| `music_filter_enabled` | 필터 사용 여부. 켜지면 자동수락도 함께 동작한다 |
| `music_filter_prompt` | 사장님이 쓴 매장 분위기 설명. 유일한 매장 판단 정책이다 |
| `music_filter_public_notice` | 위 설명에서 생성해 저장한 손님용 신청곡 안내 |

- 별도의 필터 강도는 없다. 각 요청에는 그 시점의 최신 설명을 그대로 전달한다.
- 레거시 `music_filter_strictness` 컬럼은 마이그레이션 호환으로만 남아 있고 API·프롬프트에 쓰지 않는다.
- 대시보드의 `AI 필터` 버튼이 `music_filter_enabled`를 켜고 끈다. 설정 화면은 설명만 편집하며 활성 상태에서 설명을 비워 저장할 수 없다.

## 판단 흐름

```text
카페·신청 상태 확인 → 입력·플랫폼 검증 → 활성 중복·큐 한도 확인
→ 트랙 메타데이터 구성 → LLM 판단 → 저장 및 실시간 반영
```

이미 거절될 요청에는 LLM 비용을 쓰지 않는다.

입력은 서버가 조회해 단기 서명 토큰으로 고정한 곡 제목, 아티스트·채널, 플랫폼, 길이다. 필터는 실제 음원을 듣지 않고 이 메타데이터만으로 판단한다. 신청자명은 신청 내역에만 저장하고 LLM 입력에는 포함하지 않는다.

출력은 tool(function) call 인자의 JSON Schema로 강제한다. `response_format(json_schema)`은 일부 프로바이더만 지원하므로 사용하지 않는다.

```json
{
  "decision": "accept",
  "confidence": 0.82,
  "reason": "잔잔한 팝 계열로 매장 분위기와 충돌하지 않습니다."
}
```

허용 판단은 `accept`와 `reject`뿐이다. 중간 상태나 자유 형식 응답은 정상 판단으로 사용하지 않는다.

## 상태 계약

AI 판단 결과는 일반 큐 상태와 분리해 저장한다.

| 상황 | `status` | `filter_status` |
| --- | --- | --- |
| 필터 OFF | `pending` | `skipped` |
| LLM 수락 | `pending` | `accepted` |
| LLM 거절 | `rejected` | `rejected` |
| LLM 오류 | `rejected` | `error_rejected` |

- LLM이 수락해도 서버는 `pending`으로 저장한다. `accepted`·`playing` 전환은 사장님 앱이 담당한다.
- 자동수락은 `status=pending && filter_status=accepted`만 승격한다. 필터가 꺼진 동안 들어온 `skipped` 곡은 승격하지 않는다.
- 자동수락 판단은 사장님 화면이 하고 실제 재생 시작만 재생 리더로 제한한다. 여러 대가 붙어 있으면 수락 요청이 중복될 수 있으나 서버 상태 전이가 이를 흡수한다.

## Fail-closed

다음 오류에서는 신청곡을 통과시키지 않는다.

```text
API key 누락 · 요청 timeout · 네트워크·HTTP 오류
빈 응답 · JSON 파싱 실패 · 스키마에 맞지 않는 판단
```

처리 결과는 `status=rejected`, `filter_status=error_rejected`, 손님 응답 503, 사장님 앱 `music_filter_error` 알림이다. 한 곡을 놓치는 비용보다 부적절한 곡이 자동 재생되는 비용이 크다는 판단이다.

## 프롬프트 안전

프롬프트는 곡 메타데이터 안의 문장을 명령이 아닌 심사 대상 데이터로 취급하도록 지시한다.

- 사용자 입력에 포함된 지시문과 정책 무시 요청을 따르지 않는다.
- 곡 정보에 없는 사실을 확정적으로 만들지 않는다.
- 응답은 지정된 구조만 사용한다.

프롬프트 방어는 완전한 보안 경계가 아니다. 최종 허용값 제한과 fail-closed 처리는 서버가 담당한다.

## 손님용 신청곡 안내

사장님은 내부 판정 문법을 맞추지 않고 편한 언어로 설명을 쓴다. 설명을 처음 저장하거나 내용이 달라지면 LLM이 한 번만 손님용 안내로 정리한다.

```text
매장 분위기 설명 저장 → 기존 설명·저장 안내 비교
→ 설명 변경 또는 안내 누락일 때만 공개 문구 생성
→ 설명·공개 문구·모델·생성 시각 저장 → 공지 섹션에 저장 문구 표시
```

- 손님 큐 조회는 저장된 결과만 반환하므로 반복 조회에 LLM 비용을 쓰지 않는다.
- 원본 설명은 손님에게 공개하지 않는다. 공개 문구는 거절 규칙을 나열하지 않고 어떤 분위기의 곡이 좋은지 180자 이내 1~2문장으로 설명한다.
- 생성에 실패하면 원문을 대신 노출하거나 이전 안내와 새 설명을 섞지 않고 설정 저장을 중단한다.
- 설명이 같고 저장된 안내가 있으면 필터 ON/OFF 변경만으로 다시 생성하지 않는다.

## 감사 데이터

`recommendations`에 판단 정보를 저장한다.

```text
filter_status · filter_reason · filter_confidence · filter_model
filter_error_code · filter_checked_at · filter_prompt_snapshot
```

- `filter_prompt_snapshot`은 그 판단에 실제 사용한 설명을 보존한다. 설정 변경 시각으로 과거 프롬프트를 추정하지 않으며, 감사 기능 도입 전 판단은 `null`로 둔다.
- 설정 변경은 `music_filter_prompt_history`에 기록한다. 마이그레이션 시점의 기존 설정은 `record_type=baseline`, 이후 변경은 `changed`다. 같은 값을 다시 적용하면 이력을 만들지 않는다.
- `filter_confidence`는 LLM이 스스로 보고한 값이며 보정된 확률이 아니다. 자동수락 조건이나 운영 임계값에 쓰지 않고 감사 데이터로만 보존한다.

## 평가 데이터셋

운영자는 관리자 콘솔의 카페별 판단 이력 또는 `/labeling-lab`의 통합 큐에서 골드 라벨을 기록한다. 허용값은 `server/src/constants/music-filter-review.js`와 `server/src/constants/music-labeling.js`가 기준이다.

**정책 검수** — `music_filter_reviews`에 추천곡당 한 건.

```text
human_decision       accept | reject | undetermined
human_reason_code    policy_match | policy_mismatch | unsafe_content | metadata_insufficient | other
metadata_sufficient  boolean | null
```

**곡 특성 라벨** — `music_track_annotations`에 `(platform, track_key)`당 한 건.

```text
artist_name · track_version · tempo_class · mood_tags(최대 2)
instrumentation_type · rhythmic_character · vocal_type
genre_tags(선택, 최대 2) · note(선택) · usage_scope · schema_version
```

- 화면에는 한국어로 표시하고 DB에는 상수의 코드로 저장한다. `unknown`은 같은 항목의 다른 값과 함께 저장하지 않는다.
- 아티스트명은 운영자가 곡을 듣고 확인한다. 정규화 키는 같은 아티스트의 다른 곡 라벨을 찾는 용도로만 쓰며 자동 추정이나 라벨 복사는 하지 않는다. 참고 조회는 운영자가 요청할 때 최대 3건이다.
- 재검수는 최신 값으로 upsert한다. 정책 검수는 추천곡 삭제 시 함께 삭제되고, 곡 특성은 출처 추천곡만 비워 재사용 가능한 라벨을 보존한다.
- 사람 라벨은 `recommendations.filter_status`와 큐 `status`를 바꾸지 않는다. 음악 라벨링은 곡 버전과 메타데이터 충분성을 묻지 않고 기존 값은 보존하며 신규 값은 각각 `unknown`, `null`을 사용한다. `null`은 미확인을 뜻하며 메타데이터 부족으로 해석하지 않는다. AI 승인·거절 결과는 판단 당시 매장 정책 아래에 표시한다.
- 동일한 `(platform, track_key)`의 기존 곡 라벨이 있으면 선택값을 자동 복원하고 저장 시각을 표시한다. 매장 정책 판단은 추천곡·매장별 값이므로 다른 신청에서 복사하지 않는다.
- 음악 라벨링은 카페 구분 없이 전체·완료·미검수를 집계하고 최근 판단순 50건씩 가져온다. 저장은 기존 카페·추천곡 범위 검증을 통과한 뒤 두 레코드를 한 트랜잭션으로 반영하며, 둘 다 있어야 완료로 센다. 제목에 `Playlist` 또는 `플리`가 포함된 항목은 큐와 집계에서 제외한다.
- 현재는 수집만 한다. `usage_scope=operational`이어도 자동수락, LLM 프롬프트, Exact 재사용, 동일 아티스트 검색에 쓰지 않으며 성능 지표도 자동 계산하지 않는다. 라이브 연결은 별도 평가와 계약 변경 후 진행한다.

## 구현 위치

```text
server/src/features/music-filter/
├── music-filter.service.js  전체 판단 흐름
├── prompt.builder.js        정책과 곡 데이터를 메시지로 구성
├── llm.client.js            OpenRouter 호출·timeout·tool call 파싱
├── public-guide.service.js  매장 설명을 손님용 안내로 정제
└── decision.policy.js       판단 정규화와 오류 변환
server/src/features/music-labeling/annotation.js  수동 곡 라벨 정규화·검증
server/src/constants/music-labeling.js            수동 곡 라벨 코드·개수 제한

owner/src/pages/dashboard/MusicFilterSettings.jsx
owner/src/pages/dashboard/useRecommendationQueue.js
owner/src/pages/RecommendCard.jsx
admin/admin.js
```

환경변수는 [DEVELOPMENT.md](DEVELOPMENT.md#환경변수), 엔드포인트는 [API.md](API.md#카페-관리--cafes), 미구현 후보는 [ROADMAP.md](ROADMAP.md#ai-음악-필터)를 기준으로 한다.
