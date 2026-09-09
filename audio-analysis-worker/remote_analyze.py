"""곡마다 별도 프로세스에서 MAEST를 실행하고 재현 가능한 원본을 기록한다."""
import json
import os
import sys
import wave
from pathlib import Path
from analyze import analyze_audio, build_payload
from emotion import (
    EMBEDDING_MODEL_NAME,
    EMOTION_MODEL_NAME,
    EmotionModelError,
    file_sha256,
    load_emotion_predictor,
)
from audio_llm import AudioLLMError, describe
from download import source_url
from maest import load_audio, predict, normalize, make_annotation, MODEL_VERSION, MODEL_SHA256


def pipeline_mode(mood, audio_llm_raw):
    """실제로 돈 단계로 모드를 정한다. sources_used와 함께 읽으면 재현이 가능하다."""
    if audio_llm_raw is not None:
        return 'FULL'
    return 'MAEST_EMOTION' if mood is not None else 'MAEST_ONLY'


def audio_llm_config():
    """3단 설정만 환경에서 읽는다. 토큰은 부모가 이미 걷어낸 뒤다."""
    from worker import WorkerConfig
    return WorkerConfig(os.environ).audio_llm


def run(audio, job, output):
    model_dir = os.environ.get('AUDIO_MODEL_DIR', '~/caffeine-audio/models')
    with wave.open(str(audio), 'rb') as source:
        audio_sample_rate = source.getframerate()
        audio_duration = source.getnframes() / audio_sample_rate
    # 감정 모델은 MAEST와 같은 16kHz 배열을 쓴다. 준비되지 않은 설치에서는 감정값만
    # 비우고 장르 분석은 그대로 진행한다.
    try:
        emotion = load_emotion_predictor(model_dir)
    except EmotionModelError:
        emotion = None
    # 감정 모델을 쓸 때만 16kHz 배열을 미리 읽어 두 모델이 나눠 쓴다. 쓰지 않으면
    # predict가 알아서 읽으므로 여기서 오디오를 건드리지 않는다.
    shared = load_audio(audio) if emotion is not None else None
    audio_sha256 = file_sha256(audio)
    features, version = analyze_audio(audio, emotion, audio_16k=shared)
    raw = predict(audio, model_dir, audio=shared)
    normalized = normalize(raw, features=features)
    sources_used = [MODEL_VERSION]
    if normalized['mood'] is not None:
        sources_used += [EMBEDDING_MODEL_NAME, EMOTION_MODEL_NAME]

    # 3단은 1단 결과를 보지 않는다. 장르·택소노미를 넘길 통로 자체를 두지 않았다.
    audio_llm_raw = None
    if os.environ.get('ENABLE_AUDIO_LLM', '').strip().lower() == 'true':
        try:
            audio_llm_raw = describe(audio, audio_duration, audio_sha256, audio_llm_config())
            sources_used.append(audio_llm_raw['model_id'])
        except AudioLLMError:
            # 3단이 실패해도 1단 결과는 그대로 저장한다.
            audio_llm_raw = None
    manifest = {**job, 'rights_basis': 'platform_stream',
                'source_reference': source_url(job['platform'], job['track_key'])}
    payload = build_payload(manifest, features, f'{version}+{MODEL_VERSION}')
    payload['model_name'] = 'essentia-maest'
    run_data = {'schema_version': 1,
                'pipeline_mode': pipeline_mode(normalized['mood'], audio_llm_raw),
                'sources_used': sources_used,
                'maest_model_version': MODEL_VERSION, 'model_sha256': MODEL_SHA256,
                'audio_source_url': manifest['source_reference'], 'audio_local_path': None,
                'audio_sha256': audio_sha256, 'audio_duration_sec': audio_duration,
                'audio_sample_rate': audio_sample_rate, 'maest_raw': raw,
                'audio_llm_raw': audio_llm_raw, 'normalized': normalized}
    result = {'result': payload, 'automatic_annotation': make_annotation(features, normalized, job['artist_name']),
              'tag_scores': dict(zip(raw['classes'], raw['mean'])), 'maest_run': run_data}
    Path(output).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    return result


if __name__ == '__main__':
    try:
        run(sys.argv[1], json.loads(Path(sys.argv[2]).read_text()), sys.argv[3])
    except EmotionModelError:
        sys.exit(3)
