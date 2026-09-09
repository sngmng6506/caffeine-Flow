"""곡마다 별도 프로세스에서 MAEST를 실행하고 재현 가능한 원본을 기록한다."""
import json
import os
import sys
import wave
from pathlib import Path
from analyze import analyze_audio, build_payload
from emotion import EmotionModelError, file_sha256
from download import source_url
from maest import predict, normalize, make_annotation, MODEL_VERSION, MODEL_SHA256


def run(audio, job, output):
    model_dir = os.environ.get('AUDIO_MODEL_DIR', '~/caffeine-audio/models')
    with wave.open(str(audio), 'rb') as source:
        audio_sample_rate = source.getframerate()
        audio_duration = source.getnframes() / audio_sample_rate
    features, version = analyze_audio(audio, None)
    raw = predict(audio, model_dir)
    normalized = normalize(raw)
    manifest = {**job, 'rights_basis': 'platform_stream',
                'source_reference': source_url(job['platform'], job['track_key'])}
    payload = build_payload(manifest, features, f'{version}+{MODEL_VERSION}')
    payload['model_name'] = 'essentia-maest'
    run_data = {'schema_version': 1, 'pipeline_mode': 'MAEST_ONLY', 'sources_used': [MODEL_VERSION],
                'maest_model_version': MODEL_VERSION, 'model_sha256': MODEL_SHA256,
                'audio_source_url': manifest['source_reference'], 'audio_local_path': None,
                'audio_sha256': file_sha256(audio), 'audio_duration_sec': audio_duration,
                'audio_sample_rate': audio_sample_rate, 'maest_raw': raw,
                'audio_llm_raw': None, 'normalized': normalized}
    result = {'result': payload, 'automatic_annotation': make_annotation(features, normalized, job['artist_name']),
              'tag_scores': dict(zip(raw['classes'], raw['mean'])), 'maest_run': run_data}
    Path(output).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    return result


if __name__ == '__main__':
    try:
        run(sys.argv[1], json.loads(Path(sys.argv[2]).read_text()), sys.argv[3])
    except EmotionModelError:
        sys.exit(3)
