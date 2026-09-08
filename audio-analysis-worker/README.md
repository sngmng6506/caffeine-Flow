# Essentia 오디오 분석 워커

**로컬 음원 파일**에서 특징값을 추출해 Caffeine Flow 라벨링 Lab에 전달한다. 원본 오디오는 서버로 전송하지 않고 수치만 보낸다.

실행 방식은 두 가지다.

- `analyze.py` — 한 곡을 직접 분석하는 CLI. 처음 확인하거나 한두 곡만 볼 때 쓴다.
- `worker.py` — 디렉터리 큐를 폴링하는 상주 워커. 미니PC에 systemd 서비스로 올려 둔다.

## CLI로 한 곡 분석

Python 3.10~3.12 환경을 권장한다.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt          # Valence/Arousal까지 쓰려면
                                                  # requirements-tensorflow.txt

export AUDIO_ANALYSIS_WORKER_TOKEN='서버와 같은 랜덤 토큰'
python analyze.py ./track.wav \
  --platform youtube \
  --track-key VIDEO_ID \
  --server-url http://localhost:3000
```

Windows PowerShell에서는 `source` 대신 `.\.venv\Scripts\Activate.ps1`, `export` 대신 `$env:AUDIO_ANALYSIS_WORKER_TOKEN='...'`를 사용한다.

`--dry-run`을 사용하면 서버에 제출하지 않고 JSON 결과만 확인한다.

## 추출 범위

음향 수치는 항상 나온다.

- BPM과 비트 신뢰도
- 조성, 장·단조, 조성 강도
- danceability
- 평균 음량, 다이내믹 복잡도
- spectral centroid, energy

라벨링 화면의 선택지 추천은 두 갈래로 만든다.

| 추천 칸 | 근거 | 신뢰도 |
| --- | --- | --- |
| 체감 템포 | BPM 구간 | 없음 (확률이 아님) |
| 리듬 특징 | danceability 구간 | 없음 (확률이 아님) |
| 주요 분위기 | `mood_*` 분류 헤드 | 헤드 확률 |
| 사운드 구성 | `mood_acoustic` + `mood_electronic` | 두 확률 중 낮은 쪽 |
| 보컬 유형 | `voice_instrumental` (+랩 구분에 장르 보조) | 헤드 확률 |
| 장르 | `genre_rosamerica` 상위 2개 | 1위 확률 |

**확신하지 못한 칸은 채우지 않는다.** 확률이 `0.6` 미만이면 값을 비우고 `missing:<칸>` 신호를 붙인다. 틀린 값을 채워 두면 눈으로 넘기는 검수에서 그대로 통과하기 때문이다. `0.75` 미만으로 채운 칸은 `low_confidence:<칸>`을 붙인다.

가장 약한 칸의 확률이 `min_confidence`로 남는다. 라벨링 큐를 이 값 오름차순으로 정렬하면 모델이 헷갈린 곡이 위로 온다.

모델끼리 어긋나면 `review_flags`에 남는다 — 목소리가 없다는데 장르가 힙합·랩(`conflict:vocal_genre`), 정반대 분위기가 함께 높음(`conflict:mood`).

## 분류 헤드 모델

`msd-musicnn` 임베딩 하나를 여러 헤드가 나눠 쓴다. 임베딩 추출이 가장 비싼 단계라 곡당 한 번만 계산한다.

```bash
cd ~/caffeine-audio/models
BASE=https://essentia.upf.edu/models/classification-heads
for HEAD in voice_instrumental mood_acoustic mood_electronic \
            mood_happy mood_sad mood_aggressive mood_relaxed mood_party \
            genre_rosamerica; do
  curl -sSfLO "$BASE/$HEAD/$HEAD-msd-musicnn-1.pb"
  curl -sSfLO "$BASE/$HEAD/$HEAD-msd-musicnn-1.json"
done
```

**`.json`을 반드시 `.pb`와 함께 받는다.** 워커가 클래스 순서와 출력 노드 이름을 이 파일에서 읽는다. 헤드마다 순서가 달라서(`["sad", "non_sad"]` vs `["non_party", "party"]`) 코드에 적어 두면 조용히 뒤집힌 값이 나온다.

받은 헤드만 사용하고 없는 것은 건너뛴다. 하나도 없으면 음향 수치와 템포·리듬 추천만 나온다.

## Valence/Arousal

분류 헤드가 분위기를 채우면 이 값은 쓰이지 않는다. 헤드가 없을 때의 fallback이며, 회귀값을 사분면으로 나눈 것이라 확률이 아니어서 신뢰도가 붙지 않는다.

| 역할 | 파일 | SHA-256 |
| --- | --- | --- |
| 임베딩 | `msd-musicnn-1.pb` | `cdea0722bcee7f731286843f2233e3aa69887bb5c3e2dce011eff55f38d04f3e` |
| 회귀 | `deam-msd-musicnn-2.pb` | `beb5eeb0909266eeb78b8d6bb1323b10829cf2fe55e3c01a13fa1846fa98b371` |

```bash
mkdir -p ~/caffeine-audio/models && cd ~/caffeine-audio/models
curl -sSfLO https://essentia.upf.edu/models/feature-extractors/musicnn/msd-musicnn-1.pb
curl -sSfLO https://essentia.upf.edu/models/classification-heads/deam/deam-msd-musicnn-2.pb
sha256sum *.pb   # 위 표와 같아야 한다
```

모델 파일은 **저장소에 커밋하지 않는다.** `AUDIO_MODEL_DIR`이 가리키는 디렉터리에 두고, 워커가 시작할 때 SHA-256을 확인한다. 해시가 다르면 예측기를 만들지 않는다.

동작 계약:

- 입력은 16kHz 모노다. 다른 특징값이 쓰는 44.1kHz 배열을 재사용하지 않고 별도로 로드한다.
- 모델 출력 순서는 `[valence, arousal]`이며 원본 척도는 DEAM 주석의 `[1, 9]`다.
- `(x - 1) / 8`로 `[0, 1]`에 옮긴 뒤 프레임 평균을 낸다.
- 비정상 프레임(NaN, inf, 학습 범위를 크게 벗어난 값)은 버리고, 남은 프레임이 없으면 `null`이다.
- Valence/Arousal이 붙은 결과는 `model_version`에 `+deam-msd-musicnn-2`가 붙는다. 서버 upsert 키가 `(platform, track_key, model_name, model_version)`이라, 감정값이 있는 결과와 없는 결과가 서로를 덮지 않는다.

`ENABLE_VALENCE_AROUSAL` 기본값은 `false`이며 `true`라고 정확히 적었을 때만 모델이 돌아간다. 결과는 라벨링 Lab에서 사람이 검수하는 보조값이고, 신청곡 자동 승인·거절에는 아직 연결하지 않는다.

## 미니PC 상주 워커

`worker.py`는 디렉터리 큐를 폴링한다. 서버가 미니PC에 접속하지 않고, 미니PC가 Railway로 outbound HTTPS만 보낸다. **미니PC에 들어오는 포트는 열지 않는다.**

```text
~/caffeine-audio/
├── inbox/<job-id>/      사람이 넣는 곳
├── processing/<job-id>/ 워커가 claim한 작업(한 번에 하나)
├── processed/<job-id>/  성공 — result.json이 함께 남는다
├── failed/<job-id>/     실패 — error.txt에 원인이 남는다
└── models/              모델 .pb 파일
```

작업 디렉터리에는 `manifest.json`과 음원 파일을 넣는다.

```json
{
  "platform": "youtube",
  "track_key": "곡 식별자",
  "audio_filename": "audio.ogg"
}
```

**작업을 넣을 때는 다른 이름으로 만든 뒤 `mv`로 옮긴다.** 파일을 복사하는 도중에 워커가 집어 가지 않게 하기 위해서다. 워커도 같은 이유로 `os.rename`으로 claim한다.

안전 규칙:

- `audio_filename`은 파일 이름만 허용한다. 경로 구분자, `..`, 절대 경로, 작업 디렉터리 밖을 가리키는 심볼릭 링크는 모두 거절한다.
- 허용 확장자는 `.wav .ogg .flac .mp3 .m4a`이고 최대 200MB다.
- 한 번에 한 곡만 분석하며, 락 파일이 워커 두 개가 같은 큐를 나눠 갖는 것을 막는다.
- 로그는 journald로 가는 구조화 JSON이며 토큰·음원·payload 전체를 남기지 않는다.
- 실패는 `DISCORD_AUDIO_WEBHOOK_URL`로 알린다. 알림 실패가 작업을 죽이지 않는다.

실패한 작업은 원인을 고친 뒤 디렉터리를 `inbox/`로 다시 옮기면 그대로 재처리된다.

### 서비스 등록

```bash
cp .env.example ~/caffeine-audio/worker.env   # 값을 채운다
chmod 600 ~/caffeine-audio/worker.env         # 토큰이 들어가므로 커밋하지 않는다

mkdir -p ~/.config/systemd/user
cp caffeine-audio-worker.service ~/.config/systemd/user/
# WorkingDirectory와 EnvironmentFile 경로가 이 기계와 맞는지 확인한 뒤:
systemctl --user daemon-reload
systemctl --user enable --now caffeine-audio-worker
loginctl enable-linger "$USER"   # 로그아웃해도 계속 돌게 한다

systemctl --user status caffeine-audio-worker
journalctl --user -u caffeine-audio-worker -f
```

같은 미니PC에서 CafeStudy ADB 워커가 함께 돈다면 `Nice=10`, `IOSchedulingClass=idle`, `CPUQuota`로 분석이 양보하게 둔다. 유닛 파일의 기본값은 Intel N95(4코어) 실측을 기준으로 잡았다 — 3분 음원 + Valence/Arousal이 CPU 222%, 최대 RSS 1.26GB, 15초다.

## 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CAFFEINE_FLOW_SERVER_URL` | — | 결과를 제출할 서버 |
| `AUDIO_ANALYSIS_WORKER_TOKEN` | — | 서버와 같은 값. 없으면 워커가 시작하지 않는다 |
| `ENABLE_VALENCE_AROUSAL` | `false` | Valence/Arousal 추정 스위치. `true`만 참으로 본다 |
| `AUDIO_WORKER_ROOT` | `~/caffeine-audio` | 큐 디렉터리 루트 |
| `AUDIO_MODEL_DIR` | `~/caffeine-audio/models` | 모델 `.pb` 위치 |
| `POLL_INTERVAL_MS` | `5000` | 큐가 비었을 때 재확인 간격 |
| `DISCORD_AUDIO_WEBHOOK_URL` | — | 실패 알림. 비우면 알리지 않는다 |
| `AUDIO_WORKER_DRY_RUN` | `false` | `true`면 분석만 하고 제출하지 않는다 |

## 테스트

```bash
python -m unittest discover -s audio-analysis-worker -p 'test_*.py'
```

모델 예측기는 주입 가능하다. 단위 테스트는 실제 모델이나 네트워크 없이 정규화·평균·빈 결과·범위 검증과 파일 상태 전이를 확인한다.

모델 예측기는 주입 가능하므로 실제 모델 파일이나 네트워크 없이 워커 로직을 검증할 수 있다.
