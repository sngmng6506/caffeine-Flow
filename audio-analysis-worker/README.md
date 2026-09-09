# Essentia 오디오 분석 워커

기본 서비스는 신청곡 URL을 자동 다운로드·분석해 Lab에 라벨을 저장한다. 원본 오디오는 서버로 전송하지 않는다. [신청곡 자동 워커](#신청곡-자동-워커-기본-서비스)를 먼저 따른다. 아래 CLI·디렉터리 큐 설명은 기존 로컬 파일 분석 호환 기능이다.

실행 방식은 세 가지다.

- `remote_worker.py` — 서버 신청곡 작업 큐를 자동 처리하는 기본 서비스.

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
python analyze.py ./authorized-track.wav \
  --platform youtube \
  --track-key VIDEO_ID \
  --rights-basis licensed \
  --source-reference 'license-ticket-2026-001' \
  --server-url http://localhost:3000
```

Windows PowerShell에서는 `source` 대신 `.\.venv\Scripts\Activate.ps1`, `export` 대신 `$env:AUDIO_ANALYSIS_WORKER_TOKEN='...'`를 사용한다.

`--dry-run`을 사용하면 서버에 제출하지 않고 JSON 결과만 확인한다. `--source-reference`에는 계약·허가·소유권을 다시 확인할 수 있는 내부 참조값을 넣고 개인 정보나 시크릿을 넣지 않는다.

## 추출 범위

- BPM과 비트 신뢰도
- 조성, 장·단조, 조성 강도
- danceability
- 평균 음량, 다이내믹 복잡도
- spectral centroid, energy
- 위 수치에 기반한 템포·리듬 추천
- Valence/Arousal (아래 스위치를 명시적으로 켰을 때만)

분위기(`mood_tags`) 추천은 Valence/Arousal 값이 있을 때만 생성한다. 값이 없으면 템포나 음량으로 분위기를 추측하지 않고 두 값을 `null`로 둔다.

## Valence/Arousal

Essentia 공식 사전학습 모델을 쓴다.

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

### 라이선스 — 평가 전용

Essentia가 배포하는 이 사전학습 모델들은 **CC BY-NC-SA 4.0(비상업)** 이다([licensing information](https://essentia.upf.edu/licensing_information.html), [models](https://essentia.upf.edu/models.html)). 그래서 다음을 지킨다.

- `ENABLE_VALENCE_AROUSAL` 기본값은 `false`다. `true`라고 정확히 적었을 때만 모델이 돌아간다.
- 결과는 라벨링 Lab에서 **사람이 검수하는 보조값**으로만 쓴다.
- 실제 신청곡 자동 승인·거절에 연결하지 않는다.
- **상업화 전에 별도 라이선스가 필요하다.** 상업 서비스에 이 값을 쓰려면 UPF와 라이선스를 맺거나, 상업 이용이 허용된 모델로 교체해야 한다.

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
  "rights_basis": "public_domain",
  "source_reference": "권리 근거",
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
| `ENABLE_VALENCE_AROUSAL` | `false` | 비상업 라이선스 모델 스위치. `true`만 참으로 본다 |
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

Essentia와 사전학습 모델은 상업 서비스 적용 전에 각각 라이선스를 확인해야 한다. 이 워커는 평가·라벨링용이며 실시간 신청 승인에는 사용하지 않는다.

## 신청곡 자동 워커 (기본 서비스)

2026-09-09부터 systemd 서비스는 `remote_worker.py`를 실행한다. 위 `worker.py` 디렉터리 큐는 수동 작업 호환용이며 같은 락을 쓰므로 둘을 동시에 실행하지 않는다.

1. 서버 마이그레이션이 기존 신청곡을 DB 작업 큐에 등록한다. 신규 신청은 저장 트랜잭션에서 등록한다. 동일 플랫폼·곡은 한 번만 분석한다.
2. 미니PC가 `/audio-analysis/jobs/claim`으로 작업을 가져와 YouTube·SoundCloud 오디오를 임시 다운로드한다. Spotify는 서버에서 unsupported 처리한다.
3. 곡마다 별도 프로세스에서 Essentia 기본 특징과 MAEST 519 스타일을 추론한다. 자동 큐는 MAEST_ONLY로 무드·보컬·악기를 미확정으로 남긴다.
4. 분석 원본·최종 자동 라벨·작업 완료를 서버에 함께 저장한다. 임시 음원은 성공·실패 모두 삭제한다. 사람 확인·수정 라벨은 덮어쓰지 않는다.
5. 워커 중단은 20분 lease 만료 후 회수하며 최대 3회 처리한다. 완료 응답 유실은 같은 lease로 재전송한다.

### 설치 및 변경 적용

```bash
# 기존 venv에서 essentia 일반 패키지와 tensorflow 패키지를 함께 설치하지 않는다.
python -m pip uninstall -y essentia
python -m pip install -r requirements-tensorflow.txt
# ffmpeg/ffprobe와 yt-dlp가 지원하는 JavaScript 런타임(예: Deno)도 설치한다.
# 지원 런타임 설치 안내: https://github.com/yt-dlp/yt-dlp/wiki/EJS
python -m yt_dlp --version
ffmpeg -version
mkdir -p ~/caffeine-audio/models
curl -fL https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.pb -o ~/caffeine-audio/models/discogs-maest-30s-pw-519l-2.pb
# SHA-256: 92783feb21187443d058b4f16d7a76f47888d43fbdc7a28e8bcc8e024603bd20
python remote_worker.py
```

서비스 등록 파일을 다시 복사하고 daemon-reload/restart한다. 서버 API와 미니PC 코드가 모두 갱신돼야 동작한다. `AUDIO_WORKER_DRY_RUN=true`는 서버 작업을 소비하지 않도록 시작을 거절한다. CLI dry-run은 유지한다.

### MAEST 추론과 원본

- 모델은 `discogs-maest-30s-pw-519l-2`, 출력은 `PartitionedCall/Identity_13` sigmoid다. [공식 메타데이터](https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.json)의 클래스 순서를 maest-metadata.json에 보존한다.
- WAV mono 16kHz로 변환 후 실제 입력 파일 SHA-256을 계산한다. MAEST patchSize=1876, patchHopSize=938(약 15.008초), batchSize=1, lastPatchMode=repeat로 마지막 구간을 포함한다. 원본에는 전처리·Essentia 버전도 기록한다.
- 전체 구간의 519개 점수와 mean/max를 저장한다. 점수는 보정된 정확도나 곡의 기원 증명이 아니다. max는 특정 구간의 높은 반응을 보여준다.
- taxonomy.json의 정적 매핑·태그별 임계값으로 기존 Lab 장르 최대 2개를 만든다. 현재 기본 임계값 0.2는 미보정 실험 기준이다. `maest.normalize(raw, taxonomy)`로 재추론 없이 정규화할 수 있다. 지원되지 않거나 약한 장르는 unknown이다.
- 자동 큐에서는 무드 정규화는 null, 기존 선택형 라벨은 unknown이다. 보컬·악기도 unknown이다. 수동 CLI의 선택적 DEAM 분석은 유지하지만 자동 MAEST 큐에서는 호출하지 않는다.
- 입력 파일은 처리 후 삭제하므로 audio_local_path=null이다. 재분석 원본은 별도 이력으로 추가하고 사람이 수정한 최종 라벨은 보존한다. 재다운로드 파일의 해시가 달라지면 다른 입력으로 구분하지만 동일 파일을 다시 확보할 수 있다고 보장하지 않는다.
- 단일 곡 10초~15분, 최대 200MB, 다운로드·변환 5분, 분석 10분 제한이다. ffmpeg/ffprobe가 필요하다. 다운로드 시 2~5초 간격을 둔다. 로그인·지역제한·삭제·플랫폼 변경은 실패로 남기며 DRM/쿠키 우회는 없다.
- 서버에 오디오를 전송하지 않는다. 모델 이용 조건은 [기존 라이선스 설명](#라이선스--평가-전용)을 확인하며 실시간 심사에 연결하지 않는다.

### 실제 곡 테스트 (서버 쓰기 없음)

서버·서비스를 바꾸기 전에 미니PC의 동일 venv에서 실행한다. 임시 음원은 지우고 전체 결과 JSON과 콘솔 상위 10개를 남긴다.

```bash
export AUDIO_MODEL_DIR="$HOME/caffeine-audio/models"
python test_track.py --platform youtube --track-key Q4_qJi_jrUg --title 'Big Band Jazz Cover' --output "$HOME/caffeine-audio/test-results/big-band.json"
python test_track.py --platform youtube --track-key yCcvpI-8E4I --title 'Leave Me Now' --output "$HOME/caffeine-audio/test-results/trap.json"
```

기존 Claude 테스트와 동일 영상 ID를 사용한 비교용 예시다. 영상 접근 가능성과 실제 다운로드 성공은 실행 시 확인한다. 상세 원본의 구간 수·마지막 end_sec, 평균/최댓값 순위, 자동 장르를 살펴본다. Audio LLM 비교와 캘리브레이션은 [로드맵](../docs/ROADMAP.md)에만 기록했다.
