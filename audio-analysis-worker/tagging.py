"""MSD MusiCNN 50개 태그를 기존 선택형 라벨로 매핑한다(평가용).

공식 schema: https://essentia.upf.edu/models/autotagging/msd/msd-musicnn-1.json
태그 점수는 보정된 확률이 아니다. 임계값 미달 항목은 unknown으로 남긴다.
"""
import math
from pathlib import Path
from emotion import EMBEDDING_MODEL_FILE, EXPECTED_SHA256, file_sha256, EmotionModelError
from suggestions import build_suggestions

CLASSES = ['rock', 'pop', 'alternative', 'indie', 'electronic', 'female vocalists', 'dance',
           '00s', 'alternative rock', 'jazz', 'beautiful', 'metal', 'chillout', 'male vocalists',
           'classic rock', 'soul', 'indie rock', 'Mellow', 'electronica', '80s', 'folk', '90s',
           'chill', 'instrumental', 'punk', 'oldies', 'blues', 'hard rock', 'ambient', 'acoustic',
           'experimental', 'female vocalist', 'guitar', 'Hip-Hop', '70s', 'party', 'country',
           'easy listening', 'sexy', 'catchy', 'funk', 'electro', 'heavy metal', 'Progressive rock',
           '60s', 'rnb', 'indie pop', 'sad', 'House', 'happy']
TAG_MAPPING_VERSION = 'msd-tags-map-1'
MIN_SCORE = 0.2
GENRES = {
    'rock_metal': ['rock', 'metal', 'alternative rock', 'heavy metal', 'hard rock', 'punk'],
    'pop': ['pop', 'indie pop'], 'hiphop_rap': ['Hip-Hop'], 'rnb_soul': ['rnb', 'soul', 'funk'],
    'electronic_dance': ['electronic', 'electronica', 'dance', 'House', 'electro'],
    'jazz': ['jazz'], 'acoustic_folk': ['folk', 'acoustic', 'country'],
    'ambient_lofi': ['ambient', 'chillout'],
}


def verify_tag_model(model_dir):
    path = Path(model_dir).expanduser() / EMBEDDING_MODEL_FILE
    if not path.is_file() or file_sha256(path) != EXPECTED_SHA256[EMBEDDING_MODEL_FILE]:
        raise EmotionModelError('MSD MusiCNN 모델이 없거나 해시가 다릅니다')
    return path


def summarize_tags(frames):
    usable = [list(frame) for frame in frames if len(frame) == len(CLASSES)
              and all(math.isfinite(float(v)) and 0 <= float(v) <= 1 for v in frame)]
    if not usable:
        raise EmotionModelError('태그 모델의 유효한 출력이 없습니다')
    return {name: sum(float(frame[i]) for frame in usable) / len(usable) for i, name in enumerate(CLASSES)}


def predict_tags(audio_path, model_dir):
    path = verify_tag_model(model_dir)
    try:
        import essentia.standard as standard
        model = standard.TensorflowPredictMusiCNN(graphFilename=str(path), output='model/Sigmoid')
        audio = standard.MonoLoader(filename=str(audio_path), sampleRate=16000)()
        return summarize_tags(model(audio))
    except Exception as error:
        raise EmotionModelError('태그 모델을 실행하지 못했습니다') from error


def make_annotation(features, scores, artist='unknown'):
    score = lambda tags: max((scores.get(tag, 0) for tag in tags), default=0)
    suggestions = build_suggestions(features)
    ranked = sorted(((score(tags), label) for label, tags in GENRES.items()), reverse=True)
    genres = [label for value, label in ranked if value >= MIN_SCORE][:2]
    acoustic = score(['acoustic', 'folk']) >= MIN_SCORE
    electronic = score(['electronic', 'electronica', 'electro']) >= MIN_SCORE
    instrumental = score(['instrumental'])
    singing = score(['male vocalists', 'female vocalists', 'female vocalist'])
    rap = score(['Hip-Hop'])
    # 악기 연주보다 보컬 근거가 강할 때만 보컬 유형을 채운다.
    vocal = 'none' if instrumental >= MIN_SCORE and instrumental > max(singing, rap) else 'unknown'
    if singing >= MIN_SCORE and singing >= max(instrumental, rap):
        vocal = 'singing'
    if rap >= MIN_SCORE and rap > max(instrumental, singing):
        vocal = 'rap_spoken'
    moods = suggestions.get('mood_tags') or []
    if not moods:
        candidates = sorted([(score(['happy']), 'joyful'), (score(['sad']), 'sad'),
                             (score(['chill', 'chillout', 'Mellow']), 'peaceful')], reverse=True)
        moods = [label for value, label in candidates if value >= MIN_SCORE][:2]
    return {
        'artist_name': artist, 'track_version': 'unknown',
        'tempo_class': suggestions.get('tempo_class', 'unknown'),
        'mood_tags': moods or ['unknown'],
        'instrumentation_type': 'hybrid' if acoustic and electronic else 'acoustic' if acoustic else 'electronic' if electronic else 'unknown',
        'rhythmic_character': suggestions.get('rhythmic_character', 'unknown'),
        'vocal_type': vocal, 'genre_tags': genres or ['unknown'],
        'usage_scope': 'operational', 'note': None,
    }
