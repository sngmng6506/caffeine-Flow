# Essentia 오디오 분석 워커

권리가 확인된 **로컬 음원 파일**에서 특징값을 추출해 Caffeine Flow 라벨링 Lab에 전달한다. 외부 플랫폼 URL을 다운로드하지 않으며 원본 오디오는 서버로 전송하지 않는다.

## 실행

Python 3.10~3.12 환경을 권장한다.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt

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

분위기 추천은 Valence/Arousal 값이 있을 때만 생성한다. 현재 워커는 라이선스가 별도로 필요한 사전학습 모델을 포함하지 않으므로 두 값을 `null`로 둔다. 따라서 운영자는 분위기를 직접 듣고 라벨링해야 한다.

Essentia와 사전학습 모델은 상업 서비스 적용 전에 각각 라이선스를 확인해야 한다. 이 워커는 평가·라벨링용이며 실시간 신청 승인에는 사용하지 않는다.
