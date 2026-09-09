# Essentia 오디오 분석 워커

> **AI가 읽을 때:** 미니PC 워커 설치·업데이트·신청곡 분석 테스트를 진행할 때
> **함께 갱신할 때:** 실행 파일, 모델, 환경변수, 서비스 운영 절차가 바뀔 때
> **생략 가능한 경우:** 서버 API 내부 리팩터링이나 화면 문구만 수정할 때

기본 서비스는 신청곡 URL을 자동 다운로드·분석해 Lab에 라벨을 저장한다. 원본 오디오는 서버로 전송하지 않는다. [신청곡 자동 워커](#신청곡-자동-워커-기본-서비스)를 먼저 따른다. 아래 CLI·디렉터리 큐 설명은 기존 로컬 파일 분석 호환 기능이다.

실행 방식은 세 가지다.

- `remote_worker.py` — 서버 신청곡 작업 큐를 자동 처리하는 기본 서비스.
- `analyze.py` — 한 곡을 직접 분석하는 CLI. 처음 확인하거나 한두 곡만 볼 때 쓴다.
- `worker.py` — 수동 디렉터리 큐 호환 워커. 현재 제공하는 systemd 유닛은 이 파일이 아닌 `remote_worker.py`를 실행한다.

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

## 수동 CLI 추출 범위

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

## 수동 디렉터리 큐 호환 워커

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

아래 유닛은 **신청곡 자동 워커**를 실행한다. 기존 설치 업데이트는 [Claude 세션 인수인계](#claude-세션-인수인계)를 따른다.

```bash
cp .env.example ~/caffeine-audio/worker.env   # 최초 설치 때만. 기존 파일은 덮어쓰지 않는다
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

같은 미니PC에서 CafeStudy ADB 워커가 함께 돈다면 `Nice=10`, `IOSchedulingClass=idle`, `CPUQuota`로 분석이 양보하게 둔다. 유닛의 자원 한도는 기존 감정 모델 운영을 기준으로 설정한 값이다. MAEST의 CPU·메모리·소요 시간은 미니PC에서 별도로 측정하며 기존 모델 수치를 MAEST 성능으로 간주하지 않는다.

## 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CAFFEINE_FLOW_SERVER_URL` | — | 결과를 제출할 서버 |
| `AUDIO_ANALYSIS_WORKER_TOKEN` | — | 서버와 같은 값. 없으면 워커가 시작하지 않는다 |
| `ENABLE_VALENCE_AROUSAL` | `false` | 수동 CLI/디렉터리 큐 감정 모델 스위치. 자동 MAEST 큐에서는 사용하지 않는다 |
| `AUDIO_WORKER_ROOT` | `~/caffeine-audio` | 큐 디렉터리 루트 |
| `AUDIO_MODEL_DIR` | `~/caffeine-audio/models` | 모델 `.pb` 위치 |
| `POLL_INTERVAL_MS` | `5000` | 큐가 비었을 때 재확인 간격 |
| `DISCORD_AUDIO_WEBHOOK_URL` | — | 수동 디렉터리 큐 실패 알림. 현재 자동 워커는 DB 작업 상태와 journald로 진단한다 |
| `AUDIO_WORKER_DRY_RUN` | `false` | 수동 큐에서는 제출 생략. 자동 큐에서는 true이면 시작을 거절한다. MAEST 단독 시험은 test_track.py 사용 |

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
# 수동 실행은 상주 서비스가 정지된 상태에서만 한다.
# 서비스 운영은 아래 인수인계의 등록·시작 순서를 따른다.
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

## Claude 세션 인수인계

### 범위와 현재 확인 상태

미니PC에 연결된 Claude 세션에서 **워커 업데이트와 실제 신청곡 테스트**를 진행한다. 이 문서 정리 작업에서는 미니PC·운영 DB를 변경하지 않았다.

구현 기준 커밋은 `181c359`이며 최신 main에는 이 변경이 포함되어 있어야 한다. 당시 GitHub CI의 서버·워커·프런트엔드 작업은 모두 통과했다. 로컬 서버 테스트 285개, Python 테스트 55개, Lab 요약·원본 조회 오류 복구를 확인했다. 실제 MAEST 가중치로 42초 합성 신호의 519개 출력과 마지막 구간·서버 검증도 확인했다. **음악 장르 품질을 검증한 테스트는 아니다.**

실제 YouTube 곡 테스트는 이 실행 환경의 인증서·다운로드 문제로 완료하지 못했다. 기존 Claude 세션의 네 곡 MAEST 시험 결과도 새 워커의 다운로드→DB→Lab 전체 성공을 대신하지 않는다. Audio LLM은 [후속 로드맵](../docs/ROADMAP.md)에 남겨 두고 이번 업데이트에서는 호출하지 않는다.

### 업데이트 순서

1. Railway 배포에서 구현 커밋이 반영됐고 사전 마이그레이션이 성공했는지 확인한다. [railway.json](../railway.json)의 preDeployCommand가 적용 경로다. 서버에는 자동 작업 큐와 MAEST 원본 이력 마이그레이션 두 개가 필요하다. 미니PC에서 공유 DB를 대상으로 migrate를 실행하지 않는다.
2. 기존 서비스의 WorkingDirectory·ExecStart·EnvironmentFile 경로를 확인하고 서비스를 정지한다. 처리 중인 곡이 끝날 때까지 정지가 지연될 수 있다. 다른 CafeStudy 서비스는 건드리지 않는다.
3. 저장소 작업 상태를 확인하고 main을 fast-forward로 갱신한다. 미커밋 작업이나 브랜치 분기가 있으면 보존하고 내용을 먼저 확인하며 강제 초기화하지 않는다.
4. 서비스가 사용하는 venv를 활성화하고 [설치 및 변경 적용](#설치-및-변경-적용)을 따른다. MAEST 가중치가 이미 있으면 재다운로드 전에 해시부터 확인한다. ffmpeg·ffprobe와 서비스 PATH에서 실행 가능한 Deno도 확인한다.
5. [서버 쓰기 없는 실제 곡 테스트](#실제-곡-테스트-서버-쓰기-없음)를 먼저 수행한다. 통과 후 기존 worker.env를 유지하면서 서버 URL·토큰·모델 경로와 dry-run=false를 확인한다. 토큰 값을 출력하거나 보고서에 옮기지 않는다.
6. 새 systemd 유닛을 설치하되 기계별 경로 설정을 유지한다. daemon-reload 후 서비스를 시작하고 신청곡→DB→Lab을 확인한다. 시작 즉시 기존 대기 신청곡도 처리하므로 특정 시험곡만 실행하는 명령으로 간주하지 않는다.

기본 설치 경로에 해당하는 명령 예시다. 실제 경로가 다르면 기존 서비스 설정에 맞춘다.

```bash
systemctl --user show caffeine-audio-worker -p WorkingDirectory -p ExecStart -p EnvironmentFiles
systemctl --user stop caffeine-audio-worker
cd ~/caffeine-Flow
git status --short
git switch main
git pull --ff-only origin main
source ~/caffeine-audio/venv/bin/activate
cd audio-analysis-worker
# 위 설치 절차와 서버 쓰기 없는 테스트를 수행한다.
python -c 'from maest import verify_tag_model; print(verify_tag_model("~/caffeine-audio/models"))'
# 서비스 유닛 경로를 검토·반영한 뒤 실행한다.
systemctl --user daemon-reload
systemctl --user reset-failed caffeine-audio-worker
systemctl --user start caffeine-audio-worker
systemctl --user status caffeine-audio-worker
journalctl --user -u caffeine-audio-worker -n 80 --no-pager
```

### 신청곡 테스트 완료 기준

| 확인 대상 | 확인할 결과 |
| --- | --- |
| 단독 분석 | 결과 JSON에 실제 입력 URL·SHA-256·모델 버전, 전체 519개 점수, 구간별 점수와 mean/max가 있고 마지막 구간이 곡 끝에 도달 |
| 분석 범위 | pipeline_mode=MAEST_ONLY, 무드 원본/정규화는 null, 기존 라벨은 unknown. 장르에서 보컬·악기를 추측하지 않음 |
| 신규 신청 | 테스트 매장의 정상 신청 경로로 새 곡을 신청하면 Lab 전체 보기에 나타나고 queued→processing→completed로 진행 |
| 자동 저장 | 사람이 확인하기 전부터 Lab에 장르가 채워지고 최신 원본 조회가 가능함 |
| 빠른 확인 | ‘이대로 확인 · 다음’으로 저장하고 미확정 항목의 추가 입력을 요구하지 않음 |
| 교정 | 곡을 듣고 장르를 수정한 뒤 다시 조회하면 최종 라벨에 반영되고 자동 원본은 유지됨 |
| 지원 플랫폼 | YouTube와 SoundCloud 단일 곡을 각각 시험. Spotify 신청은 unsupported이며 다운로드하지 않음 |
| 자원 | 곡 길이·구간 수·처리 시간·서비스 메모리 사용량을 기록하고 서비스의 자원 한도 안에서 완료하는지 확인 |

같은 플랫폼·곡은 작업이 중복 생성되지 않는다. `test_track.py`는 서버 큐를 만들거나 기존 작업을 재실행하지 않는다. 이미 completed/failed인 곡을 다시 신청해도 새 분석을 보장하지 않으므로 자동 큐 시험에는 아직 분석하지 않은 곡을 쓴다. 현재 재큐잉·원본 삭제용 관리자 API는 없다. 재분석 시 사람 라벨 보호와 완료 재전송의 멱등성은 서버 회귀 테스트로 확인했으며, 시험을 위해 운영 DB 상태를 임의 변경하지 않는다.

### 실패 진단과 결과 전달

- DOWNLOAD_FAILED는 먼저 동일 venv의 yt-dlp, ffmpeg/ffprobe, Deno와 원본 URL 접근을 확인한다. 인증서 오류는 시스템 신뢰 저장소를 확인하고 TLS 검증을 끄지 않는다.
- MODEL_UNAVAILABLE는 가중치 해시·TensorflowPredictMAEST 지원·실제 서비스 venv를 확인한다. 모델 시작 전 확인 실패는 작업 claim 전에 중단된다.
- HTTP 401/503은 서버/워커 토큰 설정, 404는 서버 배포 버전, 413은 새 작업 경로의 본문 제한 배포 여부, 400은 원본 스키마·구간 집계를 확인한다. 409는 lease 만료나 이미 바뀐 검토 버전을 확인한다.
- 자동 워커 실패는 Lab 전체 보기의 작업 상태·error_code와 journald를 함께 본다. 현재 자동 워커에 Discord 알림이 연결되어 있다고 가정하지 않는다.
- 문제 발생 시 자동 워커를 정지해 추가 작업 소비를 멈춘다. 원본 이력이 있는 MAEST 마이그레이션은 자동 롤백이 거절되므로 운영 DB 롤백을 복구 절차로 사용하지 않는다.

Claude 작업 결과에는 적용 커밋, 서비스 상태, 시험곡 URL·길이, 구간 수, 상위 mean/max 태그, 최종 자동 장르, 처리 시간·메모리, Lab 확인/교정 결과와 남은 실패를 남긴다. 전체 결과 JSON은 미니PC의 test-results에 두고 오디오·모델 가중치·토큰은 저장소에 올리지 않는다. 점수가 기대와 다르면 원본을 보존한 채 기록하고, 이 소수 곡만으로 정확도를 단정하거나 임계값을 임의 튜닝하지 않는다.
