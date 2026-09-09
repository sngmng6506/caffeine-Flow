"""deam-msd-musicnn으로 Valence/Arousal을 추정한다.

수동 CLI 경로에서만 쓰며 자동 MAEST 큐는 호출하지 않는다. 모델을 쓸 수 없으면
분위기를 추측하지 않고 `None`을 돌려준다.

모델 파일은 저장소에 커밋하지 않고 `AUDIO_MODEL_DIR`에 따로 둔다. 기대하는
SHA-256은 EXPECTED_SHA256에 적어 두어, 받아 둔 파일이 공식 배포본인지 확인한다.
"""

import hashlib
import math
from pathlib import Path

# 모델 카드가 규정한 입력 샘플레이트. 44.1kHz로 넣으면 조용히 엉뚱한 값이 나온다.
EMOTION_SAMPLE_RATE = 16000
EMBEDDING_MODEL_FILE = "msd-musicnn-1.pb"
EMOTION_MODEL_FILE = "deam-msd-musicnn-2.pb"
EMOTION_MODEL_NAME = "deam-msd-musicnn-2"
EMBEDDING_MODEL_NAME = "msd-musicnn-1"

# msd-musicnn-1.json / deam-msd-musicnn-2.json의 schema에서 읽은 노드 이름이다.
EMBEDDING_OUTPUT_NODE = "model/dense/BiasAdd"
EMOTION_INPUT_NODE = "model/Placeholder"
EMOTION_OUTPUT_NODE = "model/Identity"

# 공식 배포본(essentia.upf.edu)에서 받은 파일의 해시다. 바뀌면 다른 파일이다.
EXPECTED_SHA256 = {
    EMBEDDING_MODEL_FILE: "cdea0722bcee7f731286843f2233e3aa69887bb5c3e2dce011eff55f38d04f3e",
    EMOTION_MODEL_FILE: "beb5eeb0909266eeb78b8d6bb1323b10829cf2fe55e3c01a13fa1846fa98b371",
}

# DEAM 주석의 원본 척도. 모델은 이 범위로 회귀하도록 학습됐다.
RAW_MIN = 1.0
RAW_MAX = 9.0
# 회귀 모델은 학습 범위를 조금 넘겨 예측할 수 있다. 그 정도는 받아들이고 잘라 쓰되,
# 이보다 벗어난 프레임은 모델이 이해하지 못한 입력으로 보고 버린다.
RAW_TOLERANCE = 1.0

MODEL_ORDER = ("valence", "arousal")


class EmotionModelError(RuntimeError):
    """모델 파일이 없거나 예측기를 만들 수 없을 때."""


def normalize_score(raw):
    """DEAM 원본 척도 [1, 9]를 [0, 1]로 옮긴다."""
    return (float(raw) - RAW_MIN) / (RAW_MAX - RAW_MIN)


def _usable_frame(frame):
    if frame is None or len(frame) != len(MODEL_ORDER):
        return False
    for value in frame:
        number = float(value)
        if not math.isfinite(number):
            return False
        if number < RAW_MIN - RAW_TOLERANCE or number > RAW_MAX + RAW_TOLERANCE:
            return False
    return True


def summarize_predictions(predictions):
    """프레임별 [valence, arousal] 원본 예측을 0~1 평균 한 쌍으로 줄인다.

    믿을 수 없으면(빈 결과, 전부 비정상) `None`을 돌려준다. 호출부는 이때
    분위기를 추측하지 않고 `valence`/`arousal`을 그대로 비워 둔다.
    """
    # numpy 2차원 배열이 그대로 들어온다. `predictions or []`처럼 배열을 진리값으로
    # 쓰면 ValueError가 난다 — 실제 모델을 붙였을 때만 드러났던 버그다.
    if predictions is None:
        return None
    usable = [frame for frame in predictions if _usable_frame(frame)]
    if not usable:
        return None

    summary = {"frames": len(usable)}
    for index, name in enumerate(MODEL_ORDER):
        mean_raw = sum(float(frame[index]) for frame in usable) / len(usable)
        # 학습 범위를 살짝 넘긴 예측이 서버 검증(0~1)에 걸리지 않도록 잘라 준다.
        summary[name] = min(1.0, max(0.0, normalize_score(mean_raw)))
    return summary


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model_files(model_dir):
    """모델 파일이 있고 공식 배포본과 같은지 확인하고 경로를 돌려준다."""
    directory = Path(model_dir).expanduser()
    paths = {}
    for filename, expected in EXPECTED_SHA256.items():
        path = directory / filename
        if not path.is_file():
            raise EmotionModelError(f"모델 파일이 없습니다: {path}")
        actual = file_sha256(path)
        if actual != expected:
            raise EmotionModelError(
                f"모델 파일 해시가 다릅니다: {filename} (expected {expected}, got {actual})"
            )
        paths[filename] = path
    return paths


def load_emotion_predictor(model_dir):
    """16kHz 모노 오디오를 받아 프레임별 [valence, arousal] 원본 예측을 주는 함수."""
    paths = verify_model_files(model_dir)
    try:
        import essentia.standard as standard
    except ImportError as error:
        raise EmotionModelError(
            "essentia-tensorflow가 설치되지 않았습니다. "
            "python -m pip install -r requirements.txt를 실행하세요."
        ) from error

    try:
        embeddings = standard.TensorflowPredictMusiCNN(
            graphFilename=str(paths[EMBEDDING_MODEL_FILE]),
            output=EMBEDDING_OUTPUT_NODE,
        )
        regression = standard.TensorflowPredict2D(
            graphFilename=str(paths[EMOTION_MODEL_FILE]),
            input=EMOTION_INPUT_NODE,
            output=EMOTION_OUTPUT_NODE,
        )
    except Exception as error:
        raise EmotionModelError("감정 모델 초기화 실패") from error

    def predict(audio_16k):
        return regression(embeddings(audio_16k))

    return predict


def estimate_valence_arousal(audio_16k, predictor):
    """예측기를 돌려 요약값을 만든다. 실패하면 None — 분위기를 추측하지 않는다."""
    if predictor is None:
        return None
    try:
        return summarize_predictions(predictor(audio_16k))
    except Exception:
        import warnings
        warnings.warn("감정 모델 추론 실패: 기본 음향 특징만 저장합니다", RuntimeWarning)
        return None
