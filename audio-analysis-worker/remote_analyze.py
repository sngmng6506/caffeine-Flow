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
from audio_llm import AudioLLMError, describe, plan_segments, va_context
from download import source_url
from maest import load_audio, normalize, make_annotation


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


def pipeline_mode(mood, audio_llm_raw, maest_raw=None):
    """실제로 돈 단계로 모드를 정한다. sources_used와 함께 읽으면 재현이 가능하다."""
    if maest_raw is None:
        return 'EMOTION_LLM'
    if audio_llm_raw is not None:
        return 'FULL'
    return 'MAEST_EMOTION' if mood is not None else 'MAEST_ONLY'


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

    def describe_independently(va):
        try:
            with measure(report, 'audio_llm'):
                config = audio_llm_config(job.get('audio_llm_prompt'))
                config['va'] = va
                return describe(audio, audio_duration, audio_sha256, config, report=report)
        except AudioLLMError:
            return None

    # MAEST는 돌리지 않는다. 이 미니PC에서 곡당 76초를 쓰면서, 같은 CPU를 나눠 쓰는
    # 3단까지 4~5배 느리게 만들었다(실측: 3단 단독 16초, MAEST와 동시 76초). 장르
    # 후보를 잃는 대신 신청 시점 판단이 가능해진다. 옛 분석 행의 MAEST 원본을 읽는
    # 경로는 그대로 남아 있다.
    #
    # 그래서 3단을 별도 스레드에 띄우지 않는다. 3단은 넘길 V/A가 생긴 뒤에야 출발할
    # 수 있고 그 뒤로는 겹칠 CPU 작업이 남지 않는다 — 스레드를 두면 제출하자마자
    # 기다리기만 한다.
    raw = None
    with measure(report, 'decode_16000'):
        shared = load_audio(audio) if emotion is not None or models is not None else None
    # V/A는 3단이 듣는 구간에서만 구한다. 전곡을 돌리면 6초, 구간만이면 1.5초이고
    # 값 차이는 0.004였다. 두 단계가 같은 곳을 듣는다는 점도 맞아떨어진다.
    segments = plan_segments(audio_duration)
    with measure(report, 'features_and_emotion'):
        features, version = analyze_for_judgement(audio, emotion, audio_16k=shared,
                                                  segments=segments, report=report)
    audio_llm_raw = None
    if job.get('audio_llm_enabled', True) and os.environ.get('OPENROUTER_API_KEY', '').strip():
        audio_llm_raw = describe_independently(
            va_context(features.get('valence'), features.get('arousal')))
    normalized = normalize(raw, features=features)
    sources_used = [EMBEDDING_MODEL_NAME, EMOTION_MODEL_NAME]
    # 3단은 장르·택소노미를 받지 않는다. 넘길 통로 자체가 없다. 2단 V/A만 예외로
    # 넘어간다 — 보정된 값이라 숫자가 뜻을 갖는다.
    if audio_llm_raw is not None:
        sources_used.append(audio_llm_raw['model_id'])
    manifest = {**job, 'rights_basis': 'platform_stream',
                'source_reference': source_url(job['platform'], job['track_key'])}
    payload = build_payload(manifest, features, version)
    run_data = {'schema_version': 1,
                'pipeline_mode': pipeline_mode(normalized['mood'], audio_llm_raw, raw),
                'sources_used': sources_used,
                'maest_model_version': None, 'model_sha256': None,
                'audio_source_url': manifest['source_reference'], 'audio_local_path': None,
                'audio_sha256': audio_sha256, 'audio_duration_sec': audio_duration,
                'audio_sample_rate': audio_sample_rate, 'maest_raw': raw,
                'audio_llm_raw': audio_llm_raw, 'normalized': normalized}
    result = {'result': payload, 'automatic_annotation': make_annotation(features, normalized, job['artist_name']),
              'maest_run': run_data}
    Path(output).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    return result


if __name__ == '__main__':
    try:
        run(sys.argv[1], json.loads(Path(sys.argv[2]).read_text()), sys.argv[3])
    except EmotionModelError:
        sys.exit(3)
