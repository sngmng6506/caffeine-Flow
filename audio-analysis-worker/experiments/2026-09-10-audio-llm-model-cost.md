# Audio LLM 모델별 비용과 서술 품질 (2026-09-10)

## 측정 조건

- 곡: [Q4_qJi_jrUg](https://www.youtube.com/watch?v=Q4_qJi_jrUg) (CC-BY, 186초). **재즈 피아노로 시작해 중반에 록/메탈로 급변하는** 빅밴드 커버
- 입력: 4구간 × 30초, 16kHz 모노 wav (`AUDIO_LLM_SEGMENTS=4`, `AUDIO_LLM_CLIP_SEC=30`)
- 설정 스냅샷: `audio-pipeline.json` @ `3efc6a4`, 프롬프트 `audio-llm-1`
- 비용은 OpenRouter 단가 × 실제 usage 토큰. `gemini-2.5-pro`는 generation API 실측($0.02330375)과 계산값이 일치해 계산 방식을 검증했다
- **표본 1곡. 모델 선택의 근거로 쓰기엔 부족하다.**

## 결과

| 모델 | in | out | 곡당 | 100곡 | 지연 | 장르 전환 포착 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `google/gemini-2.5-pro` | 3171 | 1934 | **$0.02330** | $2.33 | 8.7s | ✅ "재즈 피아노로 시작했다가 록/메탈로 폭발" |
| `google/gemini-3-flash-preview` | 3198 | 344 | $0.00263 | $0.26 | 6.8s | ⚠️ "스카나 재즈 요소" — 메탈 언급 없음 |
| `google/gemini-2.5-flash` | 3171 | 335 | $0.00179 | $0.18 | 7.2s | ❌ "시작부터 끝까지 재즈 빅밴드" |
| `google/gemini-2.5-flash-lite` | 3171 | 141 | $0.00037 | $0.04 | 9.2s | ❌ "경쾌한 댄스 음악, 신디사이저" |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 585 | 506 | $0 | $0 | 10.0s | ❌ 오디오를 처리하지 않음 |
| `mistralai/voxtral-small-24b-2507` | — | — | — | — | — | 호출 자체가 실패 |

## 읽어낼 것

- **입력 토큰은 모델 간 거의 같고(3171~3198) 출력 길이가 비용을 가른다.** pro 비용의 대부분은 더 길고 자세하게 쓰기 때문이다.
- 가장 싼 `flash-lite`는 재즈 빅밴드를 **댄스 음악으로 판정**했다. 틀린 서술은 검수 부담을 줄이는 게 아니라 늘린다.
- `input_modalities`에 audio가 있어도 실제로 처리하지 못하는 모델이 있다(nemotron은 "오디오 파일을 재생해 주세요"라고 답했다).
- 구조화 출력을 tool call로 강제하는 방식을 지원하지 않는 모델이 있다(voxtral).

## 결론

`google/gemini-2.5-pro` 유지. 비용을 줄여야 하면 순서는 `:batch` 변형(절반) → 구간 수 축소 → 모델 교체.

## 결론에 못 쓴 것

- **평범한 곡에서도 pro가 필요한지 확인하지 못했다.** 이 곡은 장르가 중간에 바뀌는 특수 사례라 pro에게 유리했을 수 있다.
- 장르·길이·보컬 유무가 다양한 곡에서의 비교가 없다. 설계상 예정된 비교 실험은 아직 하지 않았다.
- 무드·악기 서술의 정확도를 사람 라벨과 대조하지 않았다. 위 표의 판정은 곡을 아는 사람의 눈대중이다.
- 같은 모델을 여러 번 호출했을 때의 변동을 보지 않았다. 1회씩만 측정했다.

## 재현

> 측정 당시 3단 스위치는 워커 환경변수 `ENABLE_AUDIO_LLM`이었다. 이후 서버 설정으로 옮겨져
> Lab 토글이 정한다. 아래 명령은 그대로 재현되지 않는다 — 기록은 손대지 않고 남긴다.

```bash
export AUDIO_MODEL_DIR="$HOME/caffeine-audio/models"
export ENABLE_AUDIO_LLM=true OPENROUTER_API_KEY=...
AUDIO_LLM_MODEL=google/gemini-2.5-flash \
  python test_track.py --platform youtube --track-key Q4_qJi_jrUg \
  --title '비교' --output "$HOME/caffeine-audio/test-results/flash.json"
```

결과 JSON의 `maest_run.audio_llm_raw.usage`에 토큰이, `generation_id`로 OpenRouter
generation API를 조회하면 실제 비용이 나온다.
