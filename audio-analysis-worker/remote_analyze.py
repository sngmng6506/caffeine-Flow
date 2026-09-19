"""상주 자식과 단일 곡 CLI가 공유하는 분석 경로."""
import json
import os
import sys
import wave
from timing import measure
from pathlib import Path
from analyze import analyze_for_judgement, build_payload
from emotion import (
    EMBEDDING_MODEL_NAME,
    EMOTION_MODEL_NAME,
    EmotionModelError,
    file_sha256,
    load_emotion_predictor,
)
from audio_llm import (AudioLLMError, DEFAULT_CLIP_SEC, SELECTION_NOTE, describe,
                       plan_segments_by_slots, va_context)
from download import source_url
from labels import load_audio, normalize, make_annotation


def initialize_models():
    """상주 자식이 한 번만 만드는 예측기. MAEST를 더 이상 싣지 않는다(332MB).

    호출부가 `models[1]`로 감정 모델을 꺼내므로 자리를 비워 둔 튜플을 돌려준다.
    """
    directory = os.environ.get('AUDIO_MODEL_DIR', '~/caffeine-audio/models')
    try:
        emotion = load_emotion_predictor(directory)
    except EmotionModelError:
        emotion = None
    return None, emotion


def pipeline_mode():
    """신청 시점 경로가 도는 단계. Valence/Arousal + Audio LLM뿐이다."""
    return 'EMOTION_LLM'


def audio_llm_config(prompt=None):
    """3단 설정만 환경에서 읽는다. 토큰은 부모가 이미 걷어낸 뒤다.

    프롬프트는 환경이 아니라 서버가 준다. 워커 파일로 되돌리면 운영자가 Lab에서
    고치지 못하게 된다.
    """
    from worker import WorkerConfig
    config = dict(WorkerConfig(os.environ).audio_llm)
    config['prompt'] = prompt
    return config


def run(audio, job, output, models=None, report=None):
    model_dir = os.environ.get('AUDIO_MODEL_DIR', '~/caffeine-audio/models')
    with wave.open(str(audio), 'rb') as source:
        audio_sample_rate = source.getframerate()
        audio_duration = source.getnframes() / audio_sample_rate
    # 준비되지 않은 설치에서는 감정값만 비우고 나머지 특징은 그대로 뽑는다.
    try:
        emotion = models[1] if models is not None else load_emotion_predictor(model_dir)
    except EmotionModelError:
        emotion = None
    # 감정 모델을 쓸 때만 16kHz 배열을 읽는다. 쓰지 않으면 건드리지 않는다.
    with measure(report, 'audio_hash'):
        audio_sha256 = file_sha256(audio)

    # 구간 길이를 여기서 읽는다. 구간은 3단보다 먼저 정해지고(2단이 같은 구간을
    # 듣는다) describe는 넘겨받은 계획을 그대로 쓰므로, 계획을 세울 때 이 설정을
    # 반영하지 않으면 AUDIO_LLM_CLIP_SEC를 바꿔도 아무 일이 일어나지 않는다.
    llm_config = audio_llm_config(job.get('audio_llm_prompt'))

    def describe_independently(va):
        try:
            with measure(report, 'audio_llm'):
                config = {**llm_config, 'va': va, 'segment_plan': segments,
                          'segment_selection': SELECTION_NOTE}
                return describe(audio, audio_duration, audio_sha256, config, report=report)
        except AudioLLMError:
            return None

    with measure(report, 'decode_16000'):
        shared = load_audio(audio) if emotion is not None or models is not None else None
    # V/A는 3단이 듣는 구간에서만 구한다. 전곡을 돌리면 6초, 구간만이면 1.5초다.
    # 두 단계가 같은 곳을 들어야 프롬프트의 밝기·활력이 서술과 어긋나지 않는다.
    #
    # 구간은 역할이 다른 두 자리를 고른다 — 곡 중앙 ±15초의 가장 큰 곳과 가장 많이
    # 반복되는 구간이다. 근거는 experiments/2026-09-19를 본다.
    clip_sec = llm_config.get('clip_sec', DEFAULT_CLIP_SEC)
    segments = plan_segments_by_slots(shared, clip_sec) if shared is not None else []
    with measure(report, 'features_and_emotion'):
        features, version = analyze_for_judgement(audio, emotion, audio_16k=shared,
                                                  segments=segments, report=report)
    audio_llm_raw = None
    if segments and job.get('audio_llm_enabled', True) and os.environ.get('OPENROUTER_API_KEY', '').strip():
        audio_llm_raw = describe_independently(
            va_context(features.get('valence'), features.get('arousal')))
    normalized = normalize(features=features)
    sources_used = [EMBEDDING_MODEL_NAME, EMOTION_MODEL_NAME]
    # 3단은 장르·택소노미를 받지 않는다. 넘길 통로 자체가 없다. 2단 V/A만 예외로
    # 넘어간다 — 보정된 값이라 숫자가 뜻을 갖는다.
    if audio_llm_raw is not None:
        sources_used.append(audio_llm_raw['model_id'])
    manifest = {**job, 'rights_basis': 'platform_stream',
                'source_reference': source_url(job['platform'], job['track_key'])}
    payload = build_payload(manifest, features, version)
    run_data = {'schema_version': 1,
                'pipeline_mode': pipeline_mode(),
                'sources_used': sources_used,
                'audio_source_url': manifest['source_reference'], 'audio_local_path': None,
                'audio_sha256': audio_sha256, 'audio_duration_sec': audio_duration,
                'audio_sample_rate': audio_sample_rate,
                'audio_llm_raw': audio_llm_raw, 'normalized': normalized}
    result = {'result': payload, 'automatic_annotation': make_annotation(features, normalized, job['artist_name']),
              'analysis_run': run_data}
    Path(output).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    return result


if __name__ == '__main__':
    try:
        run(sys.argv[1], json.loads(Path(sys.argv[2]).read_text()), sys.argv[3])
    except EmotionModelError:
        sys.exit(3)
