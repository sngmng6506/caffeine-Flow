# 오디오 분석 워커

> **AI가 읽을 때:** 미니PC 워커 설치·업데이트·신청곡 분석 테스트를 진행할 때
> **함께 갱신할 때:** 실행 파일, 모델, 환경변수, 서비스 운영 절차가 바뀔 때
> **생략 가능한 경우:** 서버 API 내부 리팩터링이나 화면 문구만 수정할 때

신청곡 URL을 미니PC가 임시 다운로드해 분석하고 **특징값과 자동 라벨만** 서버에 저장한다. 원본 오디오는 서버로 보내지 않고, 미니PC는 outbound HTTPS만 사용하며 들어오는 포트를 열지 않는다.

| 실행 파일 | 역할 |
| --- | --- |
| `remote_worker.py` | 서버 작업 큐를 처리하는 **기본 서비스**. systemd 유닛이 실행하는 파일 |
| `analyze.py` | 로컬 파일 한 곡을 분석하는 CLI (호환) |
| `worker.py` | 로컬 디렉터리 큐 워커 (호환) |

호환 경로는 기본 서비스와 같은 락을 쓰므로 동시에 실행하지 않는다.

## 신청곡 자동 워커

1. 서버가 신청 저장 트랜잭션에서 작업을 등록한다. 동일 플랫폼·곡은 한 번만 분석한다.
2. 미니PC가 `/audio-analysis/jobs/claim`으로 작업을 가져와 YouTube·SoundCloud 오디오를 임시 다운로드한다. Spotify는 서버가 unsupported로 처리한다.
3. 곡마다 **별도 프로세스**에서 Essentia 기본 특징, MAEST 519 스타일, Valence/Arousal을 추론한다. 세 모델이 같은 16kHz 배열을 나눠 쓴다.
4. `ENABLE_AUDIO_LLM=true`면 곡에서 고르게 뽑은 구간을 오디오 입력 LLM에 보내 무드·악기·보컬을 자유 서술로 받는다([2단 Audio LLM](#2단-audio-llm)).
5. 분석 원본·자동 라벨·작업 완료를 한 트랜잭션에 저장한다. 임시 음원은 성공·실패 모두 삭제한다. 사람이 수정한 라벨은 덮어쓰지 않는다.
6. 중단된 작업은 20분 lease 만료 후 회수하며 최대 3회 처리한다. 완료 응답 유실은 같은 lease로 재전송한다.

API 계약은 [docs/API.md](../docs/API.md), 데이터 흐름은 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)를 따른다.

### 설치

```bash
# essentia 일반 패키지와 tensorflow 패키지를 함께 설치하지 않는다.
python -m pip uninstall -y essentia
python -m pip install -r requirements-tensorflow.txt

python -m yt_dlp --version
ffmpeg -version        # ffprobe도 함께 필요하다

mkdir -p ~/caffeine-audio/models
curl -fL https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.pb \
  -o ~/caffeine-audio/models/discogs-maest-30s-pw-519l-2.pb
# SHA-256: 92783feb21187443d058b4f16d7a76f47888d43fbdc7a28e8bcc8e024603bd20
```

가중치가 이미 있으면 다시 받기 전에 해시부터 확인한다. 워커는 시작할 때 해시를 검증하고 다르면 기동하지 않는다.

yt-dlp에는 JavaScript 런타임(예: Deno)이 필요하다([지원 런타임](https://github.com/yt-dlp/yt-dlp/wiki/EJS)). 배포판 패키지로 설치할 수 없으면 정적 빌드를 홈 아래에 둔다.

```bash
mkdir -p ~/caffeine-audio/bin
curl -fL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  | tar -xJ --strip-components=1 -C ~/caffeine-audio/bin --wildcards '*/ffmpeg' '*/ffprobe'
curl -fL -o /tmp/deno.zip \
  https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip
unzip -o /tmp/deno.zip -d ~/caffeine-audio/bin && chmod +x ~/caffeine-audio/bin/deno
```

### 서비스 등록

```bash
cp .env.example ~/caffeine-audio/worker.env   # 최초 설치 때만. 기존 파일은 덮어쓰지 않는다
chmod 600 ~/caffeine-audio/worker.env         # 토큰이 들어가므로 커밋하지 않는다

mkdir -p ~/.config/systemd/user
cp caffeine-audio-worker.service ~/.config/systemd/user/
# WorkingDirectory와 EnvironmentFile 경로가 이 기계와 맞는지 확인한 뒤:
systemctl --user daemon-reload
systemctl --user enable --now caffeine-audio-worker
loginctl enable-linger "$USER"   # 로그아웃해도 계속 돌게 한다

journalctl --user -u caffeine-audio-worker -f
```

**systemd user 서비스의 PATH는 최소다.** `/usr/bin`에 없는 ffmpeg·ffprobe·deno를 쓰면 손으로 실행할 때는 되는데 서비스에서만 모든 곡이 `DOWNLOAD_FAILED`로 떨어진다. 바이너리를 홈 아래에 뒀다면 기계별 drop-in으로 PATH를 넓힌다.

```bash
mkdir -p ~/.config/systemd/user/caffeine-audio-worker.service.d
cat > ~/.config/systemd/user/caffeine-audio-worker.service.d/10-path.conf <<'CONF'
[Service]
Environment=PATH=%h/caffeine-audio/bin:/usr/local/bin:/usr/bin:/bin
CONF
systemctl --user daemon-reload
```

서비스를 시작하면 **대기 중인 신청곡을 모두 처리한다.** 특정 곡만 돌리는 명령이 아니다. 같은 미니PC에서 다른 워커가 함께 돈다면 유닛의 `Nice`·`IOSchedulingClass`·`CPUQuota`로 분석이 양보하게 둔다. 자원 한도는 설치한 기계에서 실측해 맞춘다.

### MAEST 추론과 원본

- 모델은 `discogs-maest-30s-pw-519l-2`, 출력은 `PartitionedCall/Identity_13` sigmoid다. [공식 메타데이터](https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.json)의 클래스 순서를 `maest-metadata.json`에 보존한다.
- WAV mono 16kHz로 변환한 뒤 **실제 입력 파일**의 SHA-256을 계산한다. 추론 설정(patch 크기·hop·마지막 구간 처리)은 `maest.py`가 단일 기준이며 Essentia 버전과 함께 원본에 기록한다.
- 전체 구간의 519개 점수와 mean/max를 저장한다. 점수는 보정된 정확도가 아니고 곡의 기원 증명도 아니다. max는 특정 구간의 높은 반응을 보여준다.
- `taxonomy.json`의 정적 매핑과 태그별 임계값으로 Lab 장르를 최대 2개 만든다. 기본 임계값은 **미보정 실험 기준**이다. `maest.normalize(raw, taxonomy)`로 재추론 없이 정규화만 다시 돌릴 수 있다. 지원되지 않거나 약한 장르는 `unknown`이다.
- 무드는 Valence/Arousal에서만 만든다. 감정 모델을 쓸 수 없으면 `pipeline_mode=MAEST_ONLY`로 남고 무드는 null이다. 보컬·악기는 `unknown`이며 **장르에서 추측해 채우지 않는다.**
- 입력 파일은 처리 후 삭제하므로 `audio_local_path`는 null이다. 재분석은 원본을 새 이력으로 추가하고 사람이 수정한 최종 라벨은 보존한다. 재다운로드 파일의 해시가 다르면 다른 입력으로 구분한다.
- 길이·용량·시간 제한과 다운로드 간격은 `download.py`가 단일 기준이다. 로그인·지역제한·삭제·플랫폼 변경은 실패로 남기며 DRM·쿠키 우회는 하지 않는다.

### 실제 곡 테스트 (서버 쓰기 없음)

서버나 서비스를 바꾸기 전에 같은 venv에서 실행한다. 서버에 아무것도 쓰지 않는다.

```bash
export AUDIO_MODEL_DIR="$HOME/caffeine-audio/models"
python test_track.py --platform youtube --track-key <VIDEO_ID> \
  --title '곡 제목' --output "$HOME/caffeine-audio/test-results/<이름>.json"
```

| 확인 대상 | 기대 결과 |
| --- | --- |
| 원본 | 입력 URL·SHA-256·모델 버전, 519개 점수, 구간별 점수와 mean/max |
| 구간 | 마지막 구간의 `end_sec`가 곡 끝에 도달 |
| 범위 | 실제로 돈 단계와 `pipeline_mode`·`sources_used`가 일치 |
| 자원 | 곡 길이 대비 처리 시간과 최대 메모리가 서비스 한도 안 |

전체 결과 JSON은 미니PC에 두고 오디오·가중치·토큰은 저장소에 올리지 않는다. 소수의 곡으로 정확도를 단정하거나 임계값을 임의로 조정하지 않는다. Audio LLM 비교와 캘리브레이션은 [ROADMAP](../docs/ROADMAP.md)에 있다.

### 실패 진단

작업 상태와 `error_code`는 Lab 전체 보기에서, 실행 로그는 journald에서 본다.

| 코드 | 먼저 확인할 것 |
| --- | --- |
| `DOWNLOAD_FAILED` | yt-dlp·ffmpeg·ffprobe·Deno가 **서비스 PATH에서** 실행되는지, 원본 URL 접근 가능 여부, 길이·용량 제한 초과 여부 |
| `SOURCE_UNSUPPORTED` | 플랫폼과 `track_key` 형식. Spotify와 플레이리스트 URL은 받지 않는다 |
| `MODEL_UNAVAILABLE` | 가중치 해시, `TensorflowPredictMAEST` 지원 여부, 서비스가 쓰는 venv |
| `ANALYSIS_FAILED` | 분석 프로세스 로그와 입력 오디오 손상 여부 |

HTTP 응답에서는 401·503이 토큰 설정, 404가 서버 배포 버전, 413이 본문 제한, 400이 원본 스키마, 409가 lease 만료나 이미 바뀐 검토 버전을 가리킨다.

인증서 오류가 나도 TLS 검증을 끄지 않는다. 문제가 계속되면 워커를 정지해 추가 작업 소비를 멈춘다. 원본 이력이 있는 마이그레이션은 자동 롤백이 거절되므로 운영 DB 롤백을 복구 절차로 쓰지 않는다.

### 2단 Audio LLM

오디오를 직접 듣는 LLM에게 무드·악기·보컬·구간 변화를 **자유 서술**로 받는다. 기본은 꺼짐이며 `ENABLE_AUDIO_LLM=true`와 `OPENROUTER_API_KEY`가 함께 있어야 동작한다. 모델은 `AUDIO_LLM_MODEL`로 고른다.

동작 계약 — 이 세 가지가 이 단계의 존재 이유다.

- **1단 결과를 프롬프트에 넣지 않는다.** MAEST 장르를 보여주면 LLM이 거기에 동조해 앙상블 효과가 사라지고, 두 결과가 갈리는 곡이 곧 어려운 곡이라는 신호도 잃는다. `audio_llm.py`에는 장르를 받을 인자 자체가 없다.
- **임베딩 벡터를 텍스트로 넣지 않는다.** 오디오 인코더의 잠재공간과 LLM 토큰공간은 정렬돼 있지 않다. LLM에는 오디오 자체를 준다.
- **택소노미를 주지 않는다.** 선택지를 좁히면 학습 분포 밖 음악(국악, 트로트 등)의 정보가 통째로 사라진다. 정규화는 나중에 사람이 하거나 별도 매핑이 한다.

곡 전체를 고르게 나눠 `AUDIO_LLM_SEGMENTS`개 구간을 `AUDIO_LLM_CLIP_SEC`초씩 16kHz 모노 wav로 잘라 보낸다. 인트로만 듣지 않으며 마지막 구간은 곡 끝에 닿는다. 원본에는 모델 ID, 프롬프트 버전, 샘플 구간, 입력 파일 해시를 함께 남겨 재현할 수 있게 한다.

토큰 사용량과 generation ID도 함께 남긴다. 요금 추적과 구간 수 조정 판단에 쓴다.

2단이 실패해도 1단 결과는 그대로 저장하고 `audio_llm_raw`만 null로 남는다.

실측(3~4분 곡, `google/gemini-2.5-pro`, 4구간 × 30초): 곡당 **$0.023**, LLM 호출 지연 약 9초. 구간을 16kHz 모노로 자르면 요청 하나가 5MB 안팎이다. 비용을 줄이려면 `AUDIO_LLM_MODEL`을 `google/gemini-2.5-flash`로 바꾸거나 `AUDIO_LLM_SEGMENTS`·`AUDIO_LLM_CLIP_SEC`을 줄인다. 대량 재분석에는 `:batch` 변형이 절반 가격이다.

`pipeline_mode`는 실제로 돈 단계를 가리킨다.

| 값 | 실행한 단계 |
| --- | --- |
| `MAEST_ONLY` | MAEST만 |
| `MAEST_EMOTION` | MAEST + Valence/Arousal |
| `FULL` | 위에 더해 Audio LLM |

## 수동 CLI (호환)

권리가 확인된 **로컬 파일** 한 곡을 분석해 결과만 제출한다. 외부 URL을 다운로드하지 않는다.

```bash
python -m pip install -r requirements.txt   # 감정 모델까지 쓰려면 requirements-tensorflow.txt

export AUDIO_ANALYSIS_WORKER_TOKEN='서버와 같은 랜덤 토큰'
python analyze.py ./authorized-track.wav \
  --platform youtube --track-key VIDEO_ID \
  --rights-basis licensed --source-reference 'license-ticket-2026-001' \
  --server-url http://localhost:3000
```

`--dry-run`은 제출 없이 JSON만 출력한다. `--source-reference`에는 권리를 다시 확인할 수 있는 내부 참조값을 넣고 개인정보나 시크릿을 넣지 않는다. Windows PowerShell에서는 `export` 대신 `$env:` 문법을 쓴다.

추출 범위는 BPM·비트 신뢰도, 조성·장단조·조성 강도, danceability, 평균 음량, 다이내믹 복잡도, spectral centroid, energy와 이에 기반한 템포·리듬 추천이다. 분위기 추천은 Valence/Arousal이 있을 때만 만든다.

### Valence/Arousal

자동 큐와 수동 CLI 모두에서 동작한다. 수동 CLI는 `ENABLE_VALENCE_AROUSAL=false`로 끌 수 있다.

| 역할 | 파일 | SHA-256 |
| --- | --- | --- |
| 임베딩 | `msd-musicnn-1.pb` | `cdea0722bcee7f731286843f2233e3aa69887bb5c3e2dce011eff55f38d04f3e` |
| 회귀 | `deam-msd-musicnn-2.pb` | `beb5eeb0909266eeb78b8d6bb1323b10829cf2fe55e3c01a13fa1846fa98b371` |

두 파일은 [essentia.upf.edu/models](https://essentia.upf.edu/models.html)에서 받아 `AUDIO_MODEL_DIR`에 두고 **저장소에 커밋하지 않는다.** 파일이 없으면 감정값은 `null`로 남는다.

- 입력은 16kHz 모노다. 다른 특징값이 쓰는 44.1kHz 배열을 재사용하지 않는다.
- 출력 순서는 `[valence, arousal]`, 원본 척도는 DEAM의 `[1, 9]`이며 `(x - 1) / 8`로 정규화한 뒤 프레임 평균을 낸다.
- 비정상 프레임(NaN, inf, 학습 범위 밖)은 버리고 남은 프레임이 없으면 `null`이다.
- 감정값이 붙은 결과는 `model_version`에 `+deam-msd-musicnn-2`가 붙어, 감정값이 없는 결과와 서로 덮지 않는다.

## 수동 디렉터리 큐 (호환)

`worker.py`는 `AUDIO_WORKER_ROOT` 아래 `inbox/ → processing/ → processed/ | failed/`를 폴링한다. 사람이 `inbox/<job-id>/`에 `manifest.json`과 음원 파일을 넣으면 처리하고, 실패한 작업은 `inbox/`로 다시 옮기면 재처리된다.

작업을 넣을 때는 **다른 이름으로 만든 뒤 `mv`로 옮긴다.** 복사 도중에 워커가 집어 가지 않게 하기 위해서다.

manifest 필드와 허용 확장자·크기 제한, 경로 검증 규칙은 `manifest.py`가 단일 기준이다. 파일 이름만 허용하며 경로 구분자·`..`·절대 경로·디렉터리 밖 심볼릭 링크는 모두 거절한다.

## 환경변수

실제 값은 저장소 밖 `worker.env`에 두고 systemd `EnvironmentFile`로 읽는다. 예시는 [.env.example](.env.example)에 있다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CAFFEINE_FLOW_SERVER_URL` | — | 결과를 제출할 서버 |
| `AUDIO_ANALYSIS_WORKER_TOKEN` | — | 서버와 같은 값. 없으면 워커가 시작하지 않는다 |
| `AUDIO_MODEL_DIR` | `~/caffeine-audio/models` | 모델 `.pb` 위치 |
| `AUDIO_WORKER_ROOT` | `~/caffeine-audio` | 락 파일과 수동 큐 디렉터리 루트 |
| `POLL_INTERVAL_MS` | `5000` | 큐가 비었을 때 재확인 간격 |
| `ENABLE_VALENCE_AROUSAL` | `true` | 수동 CLI 감정 모델 스위치. 자동 큐는 모델이 있으면 항상 돌린다 |
| `AUDIO_WORKER_DRY_RUN` | `false` | 자동 워커는 `true`면 **기동을 거절한다**. 수동 큐에서는 제출을 생략한다 |
| `DISCORD_AUDIO_WEBHOOK_URL` | — | 수동 큐 실패 알림. 자동 워커는 작업 상태와 journald로 진단한다 |
| `ENABLE_AUDIO_LLM` | `false` | 2단 Audio LLM 스위치. 켜면 `OPENROUTER_API_KEY`가 필요하다 |
| `OPENROUTER_API_KEY` | — | 2단 인증. 없이 켜면 워커가 기동하지 않는다 |
| `AUDIO_LLM_MODEL` | `google/gemini-2.5-pro` | 사용할 오디오 입력 모델 |
| `AUDIO_LLM_SEGMENTS` | `4` | 곡에서 고르게 뽑을 구간 수 |
| `AUDIO_LLM_CLIP_SEC` | `30` | 구간 길이(초) |
| `AUDIO_LLM_TIMEOUT_SEC` | `180` | 2단 호출 제한 시간 |

## 테스트

```bash
python -m unittest discover -s audio-analysis-worker -p 'test_*.py'
```

모델 예측기와 다운로더를 주입할 수 있어, 실제 모델이나 네트워크 없이 정규화·평균·빈 결과·범위 검증과 파일 상태 전이를 확인한다.
