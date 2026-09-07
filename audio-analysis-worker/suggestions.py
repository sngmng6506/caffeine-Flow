"""Essentia 수치에서 라벨링 화면의 보조 추천값을 만든다.

템포와 리듬은 음향 특징으로 제안할 수 있지만, 분위기는 Valence/Arousal을
추론한 별도 모델 결과가 있을 때만 제안한다. 휴리스틱으로 감정을 정답처럼
채우지 않는 것이 이 모듈의 핵심 계약이다.
"""


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


def mood_tags(valence, arousal):
    """0~1로 정규화된 별도 회귀 모델 출력만 선택형 분위기로 변환한다."""
    if valence is None or arousal is None:
        return []
    if arousal >= 0.75 and valence < 0.35:
        return ["aggressive", "tense"]
    if arousal >= 0.6 and valence >= 0.55:
        return ["joyful", "uplifting"]
    if arousal < 0.4 and valence >= 0.55:
        return ["peaceful", "tender"]
    if arousal < 0.4 and valence < 0.45:
        return ["sad", "nostalgic"]
    if valence < 0.4:
        return ["tense"]
    if valence >= 0.6:
        return ["joyful"]
    return []


def build_suggestions(features):
    tempo = tempo_class(features.get("bpm"))
    rhythm = rhythmic_character(features.get("danceability"))
    return {
        **({"tempo_class": tempo} if tempo else {}),
        **({"rhythmic_character": rhythm} if rhythm else {}),
        "mood_tags": mood_tags(features.get("valence"), features.get("arousal")),
    }
