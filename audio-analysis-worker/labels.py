"""분석 결과를 서버가 저장할 라벨 모양으로 바꾼다.

예전에는 MAEST(1단)가 519개 스타일 점수를 내고 이 모듈이 그것을 택소노미로 접어
`genre`를 채웠다. 신청 시점 경로에서 MAEST를 뺀 뒤로 장르를 판단하는 모델이 없어
`genre`는 항상 빈 배열이다. `unknown`으로 채우지 않는 것은 "모른다"와 "판단할
모델이 돌지 않았다"가 다르기 때문이다 — 소비처는 빈 배열일 때 장르 줄을 아예
렌더하지 않는다.
"""

import json
from pathlib import Path

from emotion import EMOTION_MODEL_NAME
from suggestions import build_suggestions

CONTRACT = json.loads(
    (Path(__file__).resolve().parents[1] / 'server/src/constants/audio-pipeline.json')
    .read_text(encoding='utf-8'))
SAMPLE_RATE = CONTRACT['audio']['sample_rate']
RESAMPLE_QUALITY = CONTRACT['audio']['resample_quality']


def load_audio(audio_path):
    """감정 모델과 구간 선택이 함께 쓰는 16kHz 모노 배열. 한 번만 디코딩한다."""
    import essentia.standard as standard
    return standard.MonoLoader(filename=str(audio_path), sampleRate=SAMPLE_RATE,
                               resampleQuality=RESAMPLE_QUALITY)()


def normalize_mood(features):
    """감정값이 있을 때만 무드를 만든다. 없으면 None — 장르로 추측하지 않는다."""
    valence, arousal = features.get('valence'), features.get('arousal')
    if valence is None or arousal is None:
        return None
    return {'valence': valence, 'arousal': arousal, 'source': EMOTION_MODEL_NAME,
            'tags': build_suggestions(features).get('mood_tags') or []}


def normalize(features=None):
    """저장할 정규화 라벨. 장르는 비우고 무드는 2단 감정값에서 채운다."""
    return {'genre': [], 'mood': normalize_mood(features or {})}


def make_annotation(features, normalized, artist='unknown'):
    suggestions = build_suggestions(features)
    return {'artist_name': artist, 'track_version': 'unknown',
            'tempo_class': suggestions.get('tempo_class', 'unknown'),
            'rhythmic_character': suggestions.get('rhythmic_character', 'unknown'),
            'genre_tags': [v['label'] for v in normalized['genre']] or ['unknown'],
            'mood_tags': (normalized.get('mood') or {}).get('tags') or ['unknown'],
            'vocal_type': 'unknown', 'instrumentation_type': 'unknown',
            'usage_scope': 'operational', 'note': None}
