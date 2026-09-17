# 오디오 분석 워커

> **AI가 읽을 때:** 미니PC 워커 설치·업데이트·신청곡 분석 테스트를 진행할 때
> **함께 갱신할 때:** 실행 파일, 모델, 환경변수, 서비스 운영 절차가 바뀔 때
> **생략 가능한 경우:** 서버 API 내부 리팩터링이나 화면 문구만 수정할 때

미니PC가 신청곡을 임시 다운로드해 분석하고 특징값·자동 라벨만 서버에 저장한다. 원본 음원은 자체 서버로 보내지 않지만 Audio LLM이 켜져 있으면 샘플 구간이 OpenRouter로 나간다. 미니PC는 outbound HTTPS만 쓰고 들어오는 포트를 열지 않는다.

| 실행 파일 | 역할 |
| --- | --- |
| `remote_worker.py` | 서버 큐를 처리하는 **기본 서비스**. systemd 유닛이 실행 |
| `analyze.py` | 로컬 파일 한 곡 분석 CLI (호환) |
| `worker.py` | 로컬 디렉터리 큐 워커 (호환) |

호환 경로는 기본 서비스와 같은 락을 쓰므로 동시에 실행하지 않는다.

API 계약은 [API.md](../docs/API.md), 데이터 흐름은 [ARCHITECTURE.md](../docs/ARCHITECTURE.md), 지켜야 할 계약은 [가드레일](../docs/AI_CHANGE_GUARDRAILS.md)이 기준이다.

## 신청곡 자동 워커

1. 서버가 신청 저장 트랜잭션에서 작업을 등록한다. 같은 플랫폼·곡은 한 건으로 중복 제거하고 명시적 재분석은 가능하다.
2. `/audio-analysis/jobs/claim`으로 작업을 가져와 YouTube·SoundCloud 오디오를 임시 다운로드한다. Spotify는 서버가 unsupported로 처리한다.
3. **상주 자식 프로세스 하나**가 Valence/Arousal을 구한 뒤 [3단 Audio LLM](#3단-audio-llm)을 호출한다. 자식 시작 시 모델 해시를 검증하고 예측기를 한 번 만든다.
4. 분석 원본·자동 라벨·작업 완료를 한 트랜잭션에 저장한다. 임시 음원은 성공·실패 모두 삭제하고 사람이 수정한 라벨은 덮어쓰지 않는다.
5. 중단된 작업은 lease 만료 후 회수한다. 결과는 로컬 outbox에 보존하고 같은 lease로 전송을 재개한다.

### 무엇을 돌리는가

| `pipeline_mode` | 실행한 단계 |
| --- | --- |
| `EMOTION_LLM` | Valence/Arousal + Audio LLM. **신청 시점 경로가 쓰는 값** |
| `MAEST_ONLY` / `MAEST_EMOTION` / `FULL` | MAEST를 돌리던 옛 실행. 저장된 행을 읽을 때만 |

**MAEST(1단)는 신청 시점 경로에서 더 이상 돌지 않는다.** 곡당 76초를 쓰는 데다 같은 4코어를 나눠 쓰는 3단까지 4~5배 느리게 만들었다(실측: 3단 단독 16초, MAEST와 동시 76초). 장르 후보를 잃는 대신 E2E가 약 90초에서 25초가 됐다. 모델 파일과 추론 코드는 저장된 행을 읽기 위해 남아 있고 호환 CLI는 그대로 전체 특징을 뽑는다.

V/A는 3단이 듣는 구간에서만 구한다 — 전곡 6.0초가 1.0초가 되고 값 차이는 0.002였다. 신청 시점 경로는 44.1kHz 계열 특징(BPM·조성·danceability 등)을 뽑지 않으므로 그 값들은 null이다.

검증하지 않은 위험은 [ROADMAP](../docs/ROADMAP.md)에 있다. 과거 측정은 [experiments/](experiments/)이며 현재 동작의 기준이 아니다.

## 설치

```bash
# essentia 일반 패키지와 tensorflow 패키지를 함께 설치하지 않는다.
python -m pip uninstall -y essentia
python -m pip install -r requirements-tensorflow.txt

python -m yt_dlp --version
ffmpeg -version        # ffprobe도 함께 필요하다
```

모델 파일은 [essentia.upf.edu/models](https://essentia.upf.edu/models.html)에서 받아 `AUDIO_MODEL_DIR`에 두고 **저장소에 커밋하지 않는다.** 해시는 `maest.py`·`emotion.py`가 기준이며 워커가 시작할 때 검증한다. 다르면 새 작업을 받지 않는다.

yt-dlp에는 JavaScript 런타임(예: Deno)이 필요하다([지원 런타임](https://github.com/yt-dlp/yt-dlp/wiki/EJS)).
배포판 패키지로 설치할 수 없으면 정적 빌드를 홈 아래(`~/caffeine-audio/bin`)에 둔다.

### 서비스 등록

```bash
cp .env.example ~/caffeine-audio/worker.env   # 최초 설치 때만
chmod 600 ~/caffeine-audio/worker.env         # 토큰이 들어가므로 커밋하지 않는다

mkdir -p ~/.config/systemd/user
cp caffeine-audio-worker.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now caffeine-audio-worker
loginctl enable-linger "$USER"                # 로그아웃해도 계속 돌게 한다
```

**systemd user 서비스의 PATH는 최소다.** `/usr/bin`에 없는 ffmpeg·ffprobe·deno를 쓰면 손으로 실행할 때는 되는데 서비스에서만 모든 곡이 `DOWNLOAD_FAILED`로 떨어진다. 바이너리를 홈 아래에 뒀다면 drop-in으로 PATH를 넓힌다.

```bash
mkdir -p ~/.config/systemd/user/caffeine-audio-worker.service.d
cat > ~/.config/systemd/user/caffeine-audio-worker.service.d/10-path.conf <<'CONF'
[Service]
Environment=PATH=%h/caffeine-audio/bin:/usr/local/bin:/usr/bin:/bin
CONF
systemctl --user daemon-reload
```

서비스를 시작하면 **대기 중인 신청곡을 모두 처리한다.** 특정 곡만 돌리는 명령이 아니다. 같은 미니PC에서 다른 워커가 함께 돈다면 `Nice`·`IOSchedulingClass`·`CPUQuota`로 양보하게 둔다.

Discord 웹훅이 있으면 설정 검증·락 획득 뒤 시작 알림을 보낸다. 모델 초기화·서버 claim 전이라 알림만으로 분석 준비 완료를 판단하지 않는다.

## 3단 Audio LLM

오디오를 직접 듣는 LLM에게 무드·보컬·구간별 변화를 **자유 서술**로 받는다. 실행 여부와 시스템 프롬프트 모두 서버 설정이 정하고 운영자가 Lab에서 바꾼다 — 워커는 claim 응답으로 받으므로 재시작이 필요 없다. `OPENROUTER_API_KEY`가 없으면 켜져 있어도 건너뛴다.

이 단계는 매장 정책을 받아 승인·거절하는 심사가 아니다. 신청 필터는 [LLM_FILTER.md](../docs/LLM_FILTER.md)가 기준이며 신규 분석 완료를 기다리지 않는다.

동작 계약:

- **1단의 장르 판단을 프롬프트에 넣지 않는다.** `audio_llm.py`에 장르를 받을 인자가 없다. 예외는 Valence/Arousal이며 `config['va']`로 받아 척도를 붙인 숫자로 넣는다 — [가드레일](../docs/AI_CHANGE_GUARDRAILS.md#audio-analysis-contract).
- **각 구간의 시간 범위를 알려 주고 `structure`를 구간별로 하나씩 받는다.** 한 서술로 뭉치게 하면 구간마다 다르게 들린 곡에서 모델이 매번 한쪽을 골라야 하고, 그 선택이 실행마다 뒤집혀 필터 판정까지 흔들렸다(실측 일치율 56% → 구간별로 나눈 뒤 90%).
- **임베딩 벡터를 텍스트로 넣지 않는다.** LLM에는 오디오 자체를 준다.
- **택소노미를 주지 않는다.** 자유 서술로 받고 정규화는 나중에 한다.

구간 선택·인코딩·응답 스키마는 `audio_llm.py`가 기준이다. 모델 ID·프롬프트 버전·샘플 구간· 입력 해시와 토큰 사용량을 함께 저장한다. 3단이 실패해도 나머지는 저장되고 `audio_llm_raw`만 null로 남는다.

프롬프트 본문은 곡별 결과에 복제하지 않는다. 기본 문장은 Git 템플릿·버전으로, Lab에서 고친 문장은 추가 전용 `audio_prompt_revisions`의 `custom-<sha256 앞 12자>`로 추적한다. 변경 절차는 [프롬프트 파일 관리](#프롬프트-파일-관리)를 따른다.

## 최신곡 수집

운영자가 Lab의 `최신곡 수집`을 누르면 요청이 쌓이고, 워커는 claim 가능한 분석 작업이 없을 때 처리한다. 소스 구현은 `discover.py`가 기준이다.

| 소스 | 가져오는 것 |
| --- | --- |
| `apple_global` | Apple 인기곡 차트(10개국 × 100곡)를 YouTube에서 찾아 등록 |
| `musicbrainz_kr` | 한국 발매 곡을 날짜 구간으로 조회해 YouTube에서 찾아 등록 |
| `soundcloud_trending` | 장르별 인기 플레이리스트(20장르 × 50곡). 곡 URL이 곧 track_key |

**장르나 검색어로 좁히지 않는다.** 수집의 목적은 카페에 어울리는 곡이 아니라 필터가 판단할 곡을 모으는 것이다. 장르를 골라 긁으면 거절해야 할 곡이 표본에서 빠진다.

지켜야 할 것:

- 한 구간(한 나라·한 장르)이 바닥나도 `scanned`를 요청량보다 작게 보고하지 않는다. 서버가 "소스를 끝까지 봤다"로 읽어 커서를 0으로 되감으면 영영 첫 구간만 본다.
- `musicbrainz_kr`은 곡(recording) 단위로 조회한다. 릴리스 단위로 검색하면 YouTube에서 풀앨범 업로드가 잡힌다. MusicBrainz의 곡 길이로 매칭을 검증한다.
- 날짜 진도는 **절대 날짜**로 남긴다. 상대적인 "며칠 전"으로 잡으면 버튼을 안 누른 사이에 나온 곡이 통째로 빠진다.
- 곡 목록 조회와 플랫폼 검색을 워커가 맡는 이유는 서버에 yt-dlp가 없고 Railway 공용 IP에서 검색을 반복하면 막힐 수 있어서다.

Lab이 보여주는 것은 **새로 등록된 곡 수**다. 0은 중복·제외·매칭 실패도 포함하므로 그 구간의 분석 완료를 뜻하지 않는다. 곡 버전(MV·라이브·직캠)은 구분하지 않는다.

## 실패 진단

작업 상태와 `error_code`는 Lab 전체 보기에서, 실행 로그는 journald에서 본다. **코드는 분류일 뿐 원인을 가리키지 않는다** — 다운로드 실패는 `download_failed` 경고의 `hint`에 원인 줄이 300자까지 남는다. 이 원문은 저널에만 남고 서버·Discord로는 코드만 나간다.

| 코드 | 먼저 확인할 것 |
| --- | --- |
| `DOWNLOAD_FAILED` | 같은 줄의 `hint`로 곡 문제인지 환경 문제인지 가른다. 환경이면 yt-dlp·ffmpeg·ffprobe·Deno가 **서비스 PATH에서** 실행되는지 확인 |
| `SOURCE_UNSUPPORTED` | 플랫폼과 `track_key` 형식. 길이 한도 밖·라이브·Spotify·플레이리스트 |
| `MODEL_UNAVAILABLE` | 가중치 해시, 서비스가 쓰는 venv |
| `ANALYSIS_FAILED` | 분석 프로세스 로그와 입력 오디오 손상 여부 |

HTTP 응답은 401·503이 토큰, 404가 서버 배포 버전, 413이 본문 제한, 400이 원본 스키마, 409가 lease 만료나 이미 바뀐 검토 버전을 가리킨다. 인증서 오류가 나도 **TLS 검증을 끄지 않는다.**

`audio_stage_finished` 로그가 단계별 `elapsed_seconds`를 남긴다. `audio_llm`은 구간 추출· 인코딩·API 호출·응답 처리를 모두 포함하므로 순수 API 왕복 시간이 아니다. `remote_job_elapsed`는 claim 이후 다운로드부터 제출까지이며 큐 대기·신청 필터를 제외하므로 **손님 요청의 종단 지연으로 읽지 않는다.**

자식 초기화와 곡 분석은 각각 600초 제한이다. 실패하면 자식을 폐기하고 새 자식이 모델을 검증한 뒤 다음 claim을 받는다. 부모는 TensorFlow를 로드하지 않는다. 모델 파일을 설치·교체하면 서비스를 재시작한다.

## 결과 보존과 장애 복구

- `AUDIO_WORKER_ROOT/outbox`에 결과를 원자적으로 기록·fsync한다. 파일 0600이며 bearer 토큰· 음원은 넣지 않는다. lease 토큰이 들어가므로 공개하거나 커밋하지 않는다.
- 저장 확인 전 네트워크 오류·5xx면 파일을 유지하고 새 claim을 멈춘다. 다른 워커가 인계받거나 관리자가 재등록한 409는 `outbox/superseded`에 남기고 자동 덮어쓰지 않는다.
- 서버가 페이로드를 거절했거나(400·422) 작업이 사라졌으면(404) `outbox/rejected`로 옮긴다. 다시 보내도 결과가 같은데 전송함은 매 반복 맨 앞에서 도는 자리라, 그런 항목 하나가 워커 전체를 멈춰 세운다. 실제로 그렇게 멈춘 적이 있다.
- 격리한 파일은 지우지도, 새 토큰으로 바꿔 보내지도 않는다. 원인을 고친 뒤 손으로 다시 보낸다. 자동 만료가 없으므로 디스크 사용량을 확인한다.
- **영구 소스 오류는 연속 실패 횟수에 세지 않는다.** 기다린다고 나아지지 않고, 그런 곡이 몇 개만 있어도 워커가 내내 휴지 상태가 되어 멀쩡한 곡이 밀린다. 실제로 `This video is unavailable` 9곡이 큐를 막은 적이 있다.
- 다시 받아도 같은 실패는 `download.py`의 `SOURCE_GONE`에 문구를 넣어 영구로 분류한다. 재시도 코드로 두면 서버가 `queued`로 되돌려 6시간마다 같은 곡이 돌아온다.
- 재시도 코드·간격의 단일 기준은 `server/src/constants/audio-pipeline.json`이다.

## 수동 CLI (호환)

권리가 확인된 **로컬 파일** 한 곡을 분석해 결과만 제출한다. 외부 URL을 받지 않는다.

```bash
python -m pip install -r requirements.txt   # 감정 모델까지 쓰려면 requirements-tensorflow.txt
export AUDIO_ANALYSIS_WORKER_TOKEN='서버와 같은 랜덤 토큰'
python analyze.py ./authorized-track.wav \
  --platform youtube --track-key VIDEO_ID \
  --rights-basis licensed --source-reference 'license-ticket-2026-001' \
  --server-url http://localhost:3000
```

`--dry-run`은 제출 없이 JSON만 출력한다. `--source-reference`에는 권리를 다시 확인할 수 있는 내부 참조값을 넣고 개인정보·시크릿을 넣지 않는다.

신청 시점 경로와 달리 BPM·조성·danceability·음량·다이내믹 복잡도·spectral centroid까지 뽑는다. 추출 범위는 `analyze.py`가 기준이다.

`worker.py`는 `AUDIO_WORKER_ROOT` 아래 `inbox/ → processing/ → processed/ | failed/`를 폴링한다. 작업을 넣을 때는 **다른 이름으로 만든 뒤 `mv`로 옮긴다** — 복사 도중에 워커가 집어 가지 않게 하기 위해서다. manifest 필드와 경로 검증은 `manifest.py`가 단일 기준이다.

### Valence/Arousal

- 입력은 16kHz 모노다. 44.1kHz 배열을 재사용하면 조용히 틀린다.
- 출력은 `[valence, arousal]`, 원본 척도 DEAM `[1, 9]`를 `(x - 1) / 8`로 정규화한 뒤 평균낸다.
- 비정상 프레임(NaN, inf, 학습 범위 밖)은 버리고 남은 프레임이 없으면 `null`이다.
- 감정값이 붙은 결과는 `model_version`에 `+deam-msd-musicnn-2`가 붙어 서로 덮지 않는다.

## 환경변수

실제 값은 저장소 밖 `worker.env`에 두고 systemd `EnvironmentFile`로 읽는다. 예시는 [.env.example](.env.example)에 있다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CAFFEINE_FLOW_SERVER_URL` | — | 결과를 제출할 서버 |
| `AUDIO_ANALYSIS_WORKER_TOKEN` | — | 서버와 같은 값. 없으면 시작하지 않는다 |
| `AUDIO_MODEL_DIR` | `~/caffeine-audio/models` | 모델 `.pb` 위치 |
| `AUDIO_WORKER_ROOT` | `~/caffeine-audio` | 락 파일과 수동 큐 루트 |
| `POLL_INTERVAL_MS` | `5000` | 큐가 비었을 때 재확인 간격 |
| `ENABLE_VALENCE_AROUSAL` | 실행 경로별 | `analyze.py` 기본 true, 수동 큐 기본 false. 자동 큐는 무관 |
| `AUDIO_WORKER_DRY_RUN` | `false` | 자동 워커는 `true`면 **기동을 거절한다** |
| `DISCORD_AUDIO_WEBHOOK_URL` | — | 워커 시작 알림, 수동 큐 실패 알림 |
| `OPENROUTER_API_KEY` | — | 3단 인증. 없으면 서버가 켜 두어도 건너뛴다 |
| `AUDIO_LLM_MODEL` | `google/gemini-2.5-pro` | 사용할 오디오 입력 모델 |
| `AUDIO_LLM_SEGMENTS` | `3` | 곡에서 고르게 뽑을 구간 수 |
| `AUDIO_LLM_CLIP_SEC` | `10` | 구간 길이(초) |
| `AUDIO_LLM_TIMEOUT_SEC` | `180` | 3단 호출 제한 시간 |

## 테스트

```bash
python -m unittest discover -s audio-analysis-worker -p 'test_*.py'
```

모델 예측기와 다운로더를 주입할 수 있어 실제 모델·네트워크 없이 정규화·범위 검증과 파일 상태 전이를 확인한다.

## 프롬프트 파일 관리

[prompts 폴더](prompts)의 `audio-description.system.j2`와 `audio-description.user.j2`가 3단의 **기본** 본문이다. 운영자가 Lab에서 시스템 프롬프트를 저장하면 claim 응답으로 실려 와 system 쪽을 대신하고, 비우면 파일로 돌아간다. user 템플릿은 서버가 덮어쓰지 않는다.
`prompt_renderer.py`는 StrictUndefined로 누락 변수를 거절한다.

user 템플릿의 입력은 `clip_count`, `va`, `segments`다. MAEST 결과·곡 제목·아티스트·택소노미를 추가하지 않는다. **기본 본문을 바꾸면** 워커 `audio_llm.py`의 `PROMPT_VERSION`과 서버 `settings.js`의 `BUILTIN_PROMPT_VERSION`을 맞춰 올린다 — 그대로 두면 변경 전후 서술이 DB에서 구분되지 않아 어떤 문장으로 만든 서술인지 되짚을 수 없다.

전체 프롬프트 목록은 [최상단 README](../README.md#llm-프롬프트-바로가기)에 있다.
