"""Essentia 수치와 분류 헤드 출력을 라벨링 화면의 보조 추천값으로 만든다.

템포와 리듬은 BPM·danceability에서 구간으로 정한다. 확률이 없는 휴리스틱이므로
`confidence`에 넣지 않는다 — 없는 신뢰도를 지어내면 "애매한 순" 정렬이 거짓말을
하게 된다.

분위기·사운드 구성·보컬·장르는 분류 헤드가 있을 때만 채우고, 고른 클래스의 확률을
그대로 신뢰도로 남긴다. 헤드가 없으면 분위기는 DEAM Valence/Arousal로 fallback하고
나머지는 비운다. 어느 경로로도 값을 못 얻으면 휴리스틱으로 추측하지 않는다.
"""

from labels import (
    MIN_CONFIDENCE,
    REVIEW_CONFIDENCE,
    contradiction_flags,
    genre_tags,
    instrumentation_type,
    mood_tags,
    mood_tags_from_valence_arousal,
    vocal_type,
)

# 확률이 붙는 필드만 신뢰도 집계에 넣는다.
SCORED_FIELDS = ("mood_tags", "instrumentation_type", "vocal_type", "genre_tags")


def tempo_class(bpm):
    if bpm is None:
        return None
    if bpm < 70:
        return "very_slow"
    if bpm < 90:
        return "slow"
    if bpm < 120:
        return "moderate"
    if bpm < 145:
        return "fast"
    return "very_fast"


def rhythmic_character(danceability):
    if danceability is None:
        return None
    if danceability < 0.35:
        return "minimal"
    if danceability >= 1.35:
        return "danceable"
    return "steady"


def _classifier_annotation(scores):
    """분류 헤드 출력에서 값과 신뢰도를 뽑는다. `scores`가 없으면 빈 결과."""
    if not isinstance(scores, dict) or not scores:
        return {}, {}

    values = {}
    confidence = {}

    moods, mood_score = mood_tags(scores)
    if moods:
        values["mood_tags"] = moods
        confidence["mood_tags"] = mood_score

    instrumentation, instrumentation_score = instrumentation_type(
        scores.get("mood_acoustic"), scores.get("mood_electronic")
    )
    if instrumentation:
        values["instrumentation_type"] = instrumentation
        confidence["instrumentation_type"] = instrumentation_score

    vocal, vocal_score = vocal_type(scores.get("voice_instrumental"), scores.get("genre_rosamerica"))
    if vocal:
        values["vocal_type"] = vocal
        confidence["vocal_type"] = vocal_score

    genres, genre_score = genre_tags(scores.get("genre_rosamerica"))
    if genres:
        values["genre_tags"] = genres
        confidence["genre_tags"] = genre_score

    return values, confidence


def build_suggestions(features, classifier_scores=None):
    """추천 라벨 + 신뢰도 + 검수 우선순위를 한 덩어리로 만든다."""
    features = features or {}
    suggestion = {}

    tempo = tempo_class(features.get("bpm"))
    if tempo:
        suggestion["tempo_class"] = tempo
    rhythm = rhythmic_character(features.get("danceability"))
    if rhythm:
        suggestion["rhythmic_character"] = rhythm

    values, confidence = _classifier_annotation(classifier_scores)
    suggestion.update(values)

    # 분류 헤드가 분위기를 못 준 경우에만 DEAM 사분면으로 채운다. 이때는 확률이
    # 아니라 회귀값을 사분면으로 나눈 것이라 신뢰도를 붙이지 않는다.
    if "mood_tags" not in suggestion:
        suggestion["mood_tags"] = mood_tags_from_valence_arousal(
            features.get("valence"), features.get("arousal")
        )

    flags = contradiction_flags(suggestion)
    for field in SCORED_FIELDS:
        score = confidence.get(field)
        if score is not None and score < REVIEW_CONFIDENCE:
            flags.append(f"low_confidence:{field}")

    # 자동으로 못 채운 칸도 사람 손이 필요하다는 신호다.
    for field in SCORED_FIELDS:
        if field not in suggestion or suggestion[field] in (None, []):
            flags.append(f"missing:{field}")

    if confidence:
        suggestion["confidence"] = {key: round(value, 4) for key, value in confidence.items()}
        # 가장 약한 필드가 이 곡의 검수 우선순위다. 큐를 이 값 오름차순으로 정렬하면
        # 모델이 헷갈린 곡이 위로 올라온다.
        suggestion["min_confidence"] = round(min(confidence.values()), 4)
    if flags:
        suggestion["review_flags"] = flags

    return suggestion


__all__ = [
    "MIN_CONFIDENCE",
    "REVIEW_CONFIDENCE",
    "build_suggestions",
    "mood_tags_from_valence_arousal",
    "rhythmic_character",
    "tempo_class",
]
