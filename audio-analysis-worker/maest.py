"""MAEST 519 스타일 원본과 파생 라벨. 무드·보컬은 장르로 추측하지 않는다."""
import json
from pathlib import Path
import numpy as np
from emotion import EMOTION_MODEL_NAME, EmotionModelError, file_sha256
from suggestions import build_suggestions

ROOT = Path(__file__).resolve().parents[1] / 'server/src/constants'
CONTRACT = json.loads((ROOT / 'audio-pipeline.json').read_text())
METADATA = json.loads((ROOT / 'maest-metadata.json').read_text())
CLASSES = METADATA['classes']
MODEL_VERSION = CONTRACT['model_version']
MODEL_SHA256 = CONTRACT['model_sha256']
SETTINGS = CONTRACT['settings']
SAMPLE_RATE = SETTINGS['sample_rate']
PATCH_SIZE = SETTINGS['patch_size']
PATCH_HOP = SETTINGS['patch_hop_size']
FRAME_HOP = SETTINGS['frame_hop']
OUTPUT = SETTINGS['output']


def verify_tag_model(model_dir):
    path = Path(model_dir).expanduser() / f'{MODEL_VERSION}.pb'
    if not path.is_file() or file_sha256(path) != MODEL_SHA256:
        raise EmotionModelError('MAEST 모델이 없거나 공식 배포본 해시와 다릅니다')
    return path


def summarize(frames, duration):
    values = np.asarray(frames, dtype=float)
    if values.size == 0 or values.shape[-1] != len(CLASSES):
        raise EmotionModelError('MAEST 출력 차원이 올바르지 않습니다')
    values = values.reshape(-1, len(CLASSES))
    if not 1 <= len(values) <= CONTRACT['max_segments'] or not np.isfinite(values).all() or np.any((values < 0) | (values > 1)):
        raise EmotionModelError('MAEST 출력 점수가 올바르지 않습니다')
    return {
        'classes': CLASSES, 'mean': values.mean(axis=0).tolist(), 'max': values.max(axis=0).tolist(),
        'segments': [{'start_sec': i * PATCH_HOP * FRAME_HOP / SAMPLE_RATE,
                      'end_sec': min(duration, (i * PATCH_HOP + PATCH_SIZE) * FRAME_HOP / SAMPLE_RATE),
                      'scores': row.tolist()} for i, row in enumerate(values)],
        'settings': dict(SETTINGS),
    }


def load_audio(audio_path):
    """MAEST와 감정 모델이 함께 쓰는 16kHz 모노 배열. 같은 파일을 두 번 디코딩하지 않는다."""
    import essentia.standard as standard
    return standard.MonoLoader(filename=str(audio_path), sampleRate=SAMPLE_RATE, resampleQuality=SETTINGS['resample_quality'])()


def predict(audio_path, model_dir, audio=None):
    path = verify_tag_model(model_dir)
    try:
        import essentia
        import essentia.standard as standard
        if audio is None:
            audio = load_audio(audio_path)
        model = standard.TensorflowPredictMAEST(graphFilename=str(path), output=OUTPUT,
                    patchSize=PATCH_SIZE, patchHopSize=PATCH_HOP, batchSize=SETTINGS['batch_size'], lastPatchMode=SETTINGS['last_patch_mode'])
        raw = summarize(model(audio), len(audio) / SAMPLE_RATE)
        raw['essentia_version'] = essentia.__version__
        return raw
    except Exception as error:
        raise EmotionModelError('MAEST 추론에 실패했습니다') from error


def normalize_mood(features):
    """감정값이 있을 때만 무드를 만든다. 없으면 None — 장르로 추측하지 않는다."""
    valence, arousal = features.get('valence'), features.get('arousal')
    if valence is None or arousal is None:
        return None
    return {'valence': valence, 'arousal': arousal, 'source': EMOTION_MODEL_NAME,
            'tags': build_suggestions(features).get('mood_tags') or []}


def normalize(raw, taxonomy=None, features=None):
    taxonomy = taxonomy or json.loads((ROOT / 'music-taxonomy.json').read_text())
    candidates = {}
    for style, score in zip(raw['classes'], raw['mean']):
        label = taxonomy['style_overrides'].get(style) or taxonomy['parent_mapping'].get(style.split('---')[0])
        threshold = taxonomy['thresholds'].get(style, taxonomy['default_threshold'])
        if label and score >= threshold and score > candidates.get(label, {}).get('confidence', -1):
            candidates[label] = {'label': label, 'source': 'maest', 'raw_label': style, 'confidence': score}
    return {'taxonomy_version': taxonomy['version'], 'calibrated': taxonomy['calibrated'],
            'genre': sorted(candidates.values(), key=lambda x: (-x['confidence'], x['label']))[:taxonomy['max_genres']],
            'mood': normalize_mood(features or {})}


def make_annotation(features, normalized, artist='unknown'):
    suggestions = build_suggestions(features)
    return {'artist_name': artist, 'track_version': 'unknown',
            'tempo_class': suggestions.get('tempo_class', 'unknown'),
            'rhythmic_character': suggestions.get('rhythmic_character', 'unknown'),
            'genre_tags': [v['label'] for v in normalized['genre']] or ['unknown'],
            'mood_tags': (normalized.get('mood') or {}).get('tags') or ['unknown'],
            'vocal_type': 'unknown', 'instrumentation_type': 'unknown',
            'usage_scope': 'operational', 'note': None}
