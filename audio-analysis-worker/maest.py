"""MAEST 519 스타일 원본과 파생 라벨. 무드·보컬은 장르로 추측하지 않는다."""
import json
from pathlib import Path
import numpy as np
from emotion import EmotionModelError, file_sha256
from suggestions import build_suggestions

ROOT = Path(__file__).parent
METADATA = json.loads((ROOT / 'maest-metadata.json').read_text())
CLASSES = METADATA['classes']
MODEL_VERSION = 'discogs-maest-30s-pw-519l-2'
MODEL_SHA256 = '92783feb21187443d058b4f16d7a76f47888d43fbdc7a28e8bcc8e024603bd20'
SAMPLE_RATE = 16000
PATCH_SIZE = 1876
PATCH_HOP = 938
FRAME_HOP = 256
OUTPUT = 'PartitionedCall/Identity_13'


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
    if not 1 <= len(values) <= 64 or not np.isfinite(values).all() or np.any((values < 0) | (values > 1)):
        raise EmotionModelError('MAEST 출력 점수가 올바르지 않습니다')
    return {
        'classes': CLASSES, 'mean': values.mean(axis=0).tolist(), 'max': values.max(axis=0).tolist(),
        'segments': [{'start_sec': i * PATCH_HOP * FRAME_HOP / SAMPLE_RATE,
                      'end_sec': min(duration, (i * PATCH_HOP + PATCH_SIZE) * FRAME_HOP / SAMPLE_RATE),
                      'scores': row.tolist()} for i, row in enumerate(values)],
        'settings': {'sample_rate': SAMPLE_RATE, 'patch_size': PATCH_SIZE, 'patch_hop_size': PATCH_HOP,
                     'frame_hop': FRAME_HOP, 'last_patch_mode': 'repeat', 'resample_quality': 4,
                     'output': OUTPUT, 'batch_size': 1},
    }


def predict(audio_path, model_dir):
    path = verify_tag_model(model_dir)
    try:
        import essentia
        import essentia.standard as standard
        audio = standard.MonoLoader(filename=str(audio_path), sampleRate=SAMPLE_RATE, resampleQuality=4)()
        model = standard.TensorflowPredictMAEST(graphFilename=str(path), output=OUTPUT,
                    patchSize=PATCH_SIZE, patchHopSize=PATCH_HOP, batchSize=1, lastPatchMode='repeat')
        raw = summarize(model(audio), len(audio) / SAMPLE_RATE)
        raw['essentia_version'] = essentia.__version__
        return raw
    except Exception as error:
        raise EmotionModelError('MAEST 추론에 실패했습니다') from error


def normalize(raw, taxonomy=None):
    taxonomy = taxonomy or json.loads((ROOT / 'taxonomy.json').read_text())
    candidates = {}
    for style, score in zip(raw['classes'], raw['mean']):
        label = taxonomy['style_overrides'].get(style) or taxonomy['parent_mapping'].get(style.split('---')[0])
        threshold = taxonomy['thresholds'].get(style, taxonomy['default_threshold'])
        if label and score >= threshold and score > candidates.get(label, {}).get('confidence', -1):
            candidates[label] = {'label': label, 'source': 'maest', 'raw_label': style, 'confidence': score}
    return {'taxonomy_version': taxonomy['version'], 'calibrated': taxonomy['calibrated'],
            'genre': sorted(candidates.values(), key=lambda x: (-x['confidence'], x['label']))[:taxonomy['max_genres']],
            'mood': None}


def make_annotation(features, normalized, artist='unknown'):
    suggestions = build_suggestions(features)
    return {'artist_name': artist, 'track_version': 'unknown',
            'tempo_class': suggestions.get('tempo_class', 'unknown'),
            'rhythmic_character': suggestions.get('rhythmic_character', 'unknown'),
            'genre_tags': [v['label'] for v in normalized['genre']] or ['unknown'],
            'mood_tags': ['unknown'], 'vocal_type': 'unknown', 'instrumentation_type': 'unknown',
            'usage_scope': 'operational', 'note': None}
