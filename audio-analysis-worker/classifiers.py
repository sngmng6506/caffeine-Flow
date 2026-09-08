"""msd-musicnn 임베딩 위에 분류 헤드를 얹어 곡 특성 확률을 구한다.

임베딩 추출이 이 파이프라인에서 가장 비싼 단계다. 헤드마다 오디오를 다시 넣으면
9배가 되므로 **임베딩은 한 번만 계산하고 모든 헤드가 나눠 쓴다.**

클래스 순서를 코드에 적지 않는다. Essentia는 `.pb` 옆에 같은 이름의 `.json`을
함께 배포하고 거기에 `classes`와 출력 노드 이름이 들어 있다. 헤드마다 순서가
제각각이라(`["sad", "non_sad"]` vs `["non_party", "party"]`) 인덱스를 가정하면
조용히 뒤집힌 값이 나온다. 그래서 항상 `.json`을 읽어 이름을 붙인다.

모델 파일이 없는 헤드는 건너뛴다. 일부만 받아 둔 미니PC에서도 받은 만큼은 돌아야
한다.
"""

import json
import math
from pathlib import Path

# emotion.py와 같은 임베딩 모델·노드를 쓴다. 한 곳에서만 정의한다.
from emotion import EMBEDDING_MODEL_FILE, EMBEDDING_OUTPUT_NODE, EMOTION_SAMPLE_RATE

# labels.py의 매핑이 기대하는 헤드 이름. 파일명은 `<헤드>-msd-musicnn-1.pb`다.
CLASSIFIER_HEADS = (
    "voice_instrumental",
    "mood_acoustic",
    "mood_electronic",
    "mood_happy",
    "mood_sad",
    "mood_aggressive",
    "mood_relaxed",
    "mood_party",
    "genre_rosamerica",
)

HEAD_FILE_SUFFIX = "-msd-musicnn-1"
DEFAULT_INPUT_NODE = "model/Placeholder"
DEFAULT_OUTPUT_NODE = "model/Softmax"


class ClassifierModelError(RuntimeError):
    """헤드 모델을 읽거나 만들 수 없을 때."""


def head_paths(model_dir, head):
    directory = Path(model_dir).expanduser()
    stem = f"{head}{HEAD_FILE_SUFFIX}"
    return directory / f"{stem}.pb", directory / f"{stem}.json"


def read_head_metadata(metadata_path):
    """모델 `.json`에서 클래스 순서와 출력 노드를 읽는다.

    UPF가 배포하는 메타데이터 형식을 그대로 따르되, 없는 항목은 Essentia 기본
    노드 이름으로 채운다.
    """
    try:
        data = json.loads(Path(metadata_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ClassifierModelError(f"모델 메타데이터를 읽을 수 없습니다: {metadata_path}") from error

    classes = data.get("classes")
    if not isinstance(classes, list) or not classes:
        raise ClassifierModelError(f"classes가 없습니다: {metadata_path}")
    if not all(isinstance(name, str) and name for name in classes):
        raise ClassifierModelError(f"classes에 빈 이름이 있습니다: {metadata_path}")

    schema = data.get("schema") or {}
    outputs = schema.get("outputs") or []
    output_node = DEFAULT_OUTPUT_NODE
    for output in outputs:
        # 확률 출력을 고른다. 임베딩 출력이 함께 적혀 있는 모델이 있다.
        if isinstance(output, dict) and output.get("output_purpose") in (None, "predictions"):
            if isinstance(output.get("name"), str) and output["name"]:
                output_node = output["name"]
                break

    inputs = schema.get("inputs") or []
    input_node = DEFAULT_INPUT_NODE
    for candidate in inputs:
        if isinstance(candidate, dict) and isinstance(candidate.get("name"), str):
            input_node = candidate["name"]
            break

    return {"classes": classes, "input_node": input_node, "output_node": output_node}


def average_class_scores(predictions, classes):
    """프레임별 확률 행렬을 `{클래스명: 평균확률}`로 줄인다.

    비정상 프레임(NaN·inf·클래스 수 불일치)은 버린다. 남은 프레임이 없으면 None을
    돌려주고, 호출부는 그 헤드를 없는 것으로 취급한다.
    """
    if predictions is None:
        return None

    usable = []
    for frame in predictions:
        if frame is None or len(frame) != len(classes):
            continue
        values = [float(value) for value in frame]
        if any(not math.isfinite(value) for value in values):
            continue
        usable.append(values)

    if not usable:
        return None
    return {
        name: sum(frame[index] for frame in usable) / len(usable)
        for index, name in enumerate(classes)
    }


class MusicnnClassifiers:
    """공유 임베딩 하나로 여러 헤드를 돌린다."""

    def __init__(self, embeddings, heads):
        self._embeddings = embeddings
        self._heads = heads

    @property
    def head_names(self):
        return tuple(self._heads)

    def predict(self, audio_16k):
        """`{헤드명: {클래스명: 확률}}`. 헤드 하나가 실패해도 나머지는 살린다."""
        if not self._heads:
            return {}
        embeddings = self._embeddings(audio_16k)
        scores = {}
        for head, (predict, classes) in self._heads.items():
            averaged = average_class_scores(predict(embeddings), classes)
            if averaged:
                scores[head] = averaged
        return scores


def load_classifiers(model_dir, heads=CLASSIFIER_HEADS):
    """받아 둔 헤드만 모아 예측기를 만든다. 하나도 없으면 None."""
    directory = Path(model_dir).expanduser()
    available = [head for head in heads if all(path.is_file() for path in head_paths(directory, head))]
    if not available:
        return None

    embedding_path = directory / EMBEDDING_MODEL_FILE
    if not embedding_path.is_file():
        raise ClassifierModelError(f"임베딩 모델이 없습니다: {embedding_path}")

    try:
        import essentia.standard as standard
    except ImportError as error:
        raise ClassifierModelError(
            "essentia-tensorflow가 설치되지 않았습니다. "
            "python -m pip install -r requirements-tensorflow.txt를 실행하세요."
        ) from error

    embeddings_model = standard.TensorflowPredictMusiCNN(
        graphFilename=str(embedding_path),
        output=EMBEDDING_OUTPUT_NODE,
    )

    loaded = {}
    for head in available:
        model_path, metadata_path = head_paths(directory, head)
        metadata = read_head_metadata(metadata_path)
        predictor = standard.TensorflowPredict2D(
            graphFilename=str(model_path),
            input=metadata["input_node"],
            output=metadata["output_node"],
        )
        loaded[head] = (predictor, metadata["classes"])

    return MusicnnClassifiers(embeddings_model, loaded)


def classify(audio_16k, classifiers):
    """예측기가 없으면 빈 dict. 특성을 추측하지 않는다."""
    if classifiers is None:
        return {}
    return classifiers.predict(audio_16k)


__all__ = [
    "CLASSIFIER_HEADS",
    "EMOTION_SAMPLE_RATE",
    "ClassifierModelError",
    "MusicnnClassifiers",
    "average_class_scores",
    "classify",
    "head_paths",
    "load_classifiers",
    "read_head_metadata",
]
