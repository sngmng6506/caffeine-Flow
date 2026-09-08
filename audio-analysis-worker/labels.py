"""분류 헤드의 클래스 확률을 라벨링 화면의 선택지 코드로 옮긴다.

이 모듈에는 모델도 numpy도 들어오지 않는다. 입력은 `{클래스명: 확률}` dict뿐이고
출력은 서버 상수(`server/src/constants/music-labeling.js`)에 있는 코드다. 덕분에
모델 파일 없이 매핑 규칙 전체를 테스트할 수 있다.

핵심 계약 두 가지.

- **클래스 순서를 인덱스로 가정하지 않는다.** Essentia 헤드마다 `["sad", "non_sad"]`
  처럼 순서가 제각각이라, 호출부가 모델 `.json`의 `classes`를 읽어 이름을 붙인 뒤
  넘긴다. 여기서는 이름으로만 찾는다.
- **애매하면 채우지 않는다.** 임계값을 못 넘으면 값을 비우고 사람이 고르게 둔다.
  틀린 값을 채워 두면 눈으로 넘기는 검수에서 그대로 통과한다.
"""

# 이 아래면 "모델이 확신하지 못했다"로 보고 값을 비운다. 라벨링 화면에서 빈 칸은
# 사람이 반드시 고르게 되므로, 틀린 값을 채우는 것보다 안전하다.
MIN_CONFIDENCE = 0.6

# 이 아래면 채우되 "확인 필요"로 표시한다. 눈으로 빠르게 넘길 때 걸러낼 기준이다.
REVIEW_CONFIDENCE = 0.75

MAX_MOOD_TAGS = 2
MAX_GENRE_TAGS = 2

# genre_rosamerica의 8개 클래스 → 우리 장르 코드.
# spe(speech)는 음악 장르가 아니라 우리 목록에 대응이 없어 other로 둔다.
ROSAMERICA_GENRES = {
    "cla": "classical",
    "dan": "electronic_dance",
    "hip": "hiphop_rap",
    "jaz": "jazz",
    "pop": "pop",
    "rhy": "rnb_soul",
    "roc": "rock_metal",
    "spe": "other",
}

# mood_* 헤드는 각각 "그 분위기인가"를 이진 분류한다. 긍정 클래스 이름만 본다.
MOOD_HEADS = {
    "mood_happy": ("happy", "joyful"),
    "mood_sad": ("sad", "sad"),
    "mood_aggressive": ("aggressive", "aggressive"),
    "mood_relaxed": ("relaxed", "peaceful"),
    "mood_party": ("party", "uplifting"),
}

# 동시에 높게 나오면 모델이 헷갈린 것이다. 사람이 들어봐야 한다.
CONTRADICTORY_MOODS = (
    frozenset({"aggressive", "peaceful"}),
    frozenset({"joyful", "sad"}),
)


def probability(scores, class_name):
    """이름으로 확률을 꺼낸다. 없거나 숫자가 아니면 None."""
    if not isinstance(scores, dict):
        return None
    value = scores.get(class_name)
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    number = float(value)
    if number != number or number < 0.0 or number > 1.0:  # NaN과 범위 밖
        return None
    return number


def vocal_type(voice_scores, genre_scores=None):
    """보컬 유형. 목소리가 있을 때만 랩·노래를 장르 신호로 가른다.

    voice_instrumental은 "목소리가 있나"만 답한다. 랩과 노래의 구분은 이 헤드에
    없으므로, 목소리가 확인된 뒤에만 힙합·스피치 확률을 보조로 쓴다.
    """
    instrumental = probability(voice_scores, "instrumental")
    voice = probability(voice_scores, "voice")
    if instrumental is None or voice is None:
        return None, None

    if instrumental >= voice:
        return "none", instrumental

    hiphop = probability(genre_scores, "hip") or 0.0
    speech = probability(genre_scores, "spe") or 0.0
    if max(hiphop, speech) >= MIN_CONFIDENCE:
        return "rap_spoken", voice
    return "singing", voice


def instrumentation_type(acoustic_scores, electronic_scores):
    """어쿠스틱·전자음 두 이진 헤드를 하나의 3분류로 합친다."""
    acoustic = probability(acoustic_scores, "acoustic")
    electronic = probability(electronic_scores, "electronic")
    if acoustic is None or electronic is None:
        return None, None

    acoustic_hit = acoustic >= MIN_CONFIDENCE
    electronic_hit = electronic >= MIN_CONFIDENCE
    if acoustic_hit and electronic_hit:
        # 둘 다 높으면 실제로 섞인 편성이다. 덜 확신한 쪽이 이 판단의 신뢰도다.
        return "hybrid", min(acoustic, electronic)
    if acoustic_hit:
        return "acoustic", acoustic
    if electronic_hit:
        return "electronic", electronic
    # 둘 다 낮다 — 모델이 어느 쪽도 아니라고 본 것이라 값을 지어내지 않는다.
    return None, max(acoustic, electronic)


def genre_tags(genre_scores):
    """rosamerica 상위 2개를 우리 코드로 옮긴다. 임계값 미만은 버린다."""
    if not isinstance(genre_scores, dict):
        return [], None

    ranked = []
    for class_name, code in ROSAMERICA_GENRES.items():
        score = probability(genre_scores, class_name)
        if score is not None and score >= MIN_CONFIDENCE:
            ranked.append((score, code))
    if not ranked:
        return [], None

    ranked.sort(reverse=True)
    chosen = []
    for score, code in ranked:
        if code not in chosen:
            chosen.append(code)
        if len(chosen) == MAX_GENRE_TAGS:
            break
    return chosen, ranked[0][0]


def mood_tags(head_scores):
    """5개 mood 헤드에서 확신하는 것만 최대 2개 고른다.

    `head_scores`는 `{"mood_happy": {...}, ...}` 형태다.
    """
    if not isinstance(head_scores, dict):
        return [], None

    ranked = []
    for head, (positive_class, code) in MOOD_HEADS.items():
        score = probability(head_scores.get(head), positive_class)
        if score is not None and score >= MIN_CONFIDENCE:
            ranked.append((score, code))
    if not ranked:
        return [], None

    ranked.sort(reverse=True)
    chosen = [code for _score, code in ranked[:MAX_MOOD_TAGS]]
    return chosen, ranked[0][0]


def mood_tags_from_valence_arousal(valence, arousal):
    """분류 헤드가 없을 때만 쓰는 DEAM 사분면 매핑."""
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


def contradiction_flags(annotation):
    """모델끼리 어긋난 조합을 표시한다. 사람이 들어볼 후보다."""
    flags = []

    moods = set(annotation.get("mood_tags") or [])
    for pair in CONTRADICTORY_MOODS:
        if pair <= moods:
            flags.append("conflict:mood")
            break

    vocal = annotation.get("vocal_type")
    genres = annotation.get("genre_tags") or []
    if vocal == "none" and "hiphop_rap" in genres:
        # 목소리가 없다는데 힙합·랩으로 분류됐다. 둘 중 하나가 틀렸다.
        flags.append("conflict:vocal_genre")

    return flags
