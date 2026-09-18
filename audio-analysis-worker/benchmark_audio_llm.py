#!/usr/bin/env python3
"""실제 곡 한 개로 Audio LLM 구간 전략별 처리시간을 비교한다.

운영 DB와 서버 큐에는 쓰지 않는다. 음원을 한 번 내려받은 뒤 각 전략을 반복 호출해
다운로드, 구간 추출, LLM 왕복, 전체 예상 시간을 분리한다. 다운로드를 매번 반복하지
않는 것은 외부 망 편차가 구간 전략 비교를 가리지 않게 하기 위해서다.
"""

import argparse
import json
import os
import statistics
import tempfile
import time
import wave
from datetime import datetime, timezone
from pathlib import Path

from audio_llm import (
    DEFAULT_BASE_URL, DEFAULT_MODEL, describe,
    EXPERIMENT_FIELDS, EXPERIMENT_SCHEMA, EXPERIMENT_SCORES, plan_segments_by_energy, va_context,
)
from download import download_audio, source_url
from emotion import file_sha256

DEFAULT_STRATEGIES = ((4, 30), (3, 15), (3, 10))


def parse_strategies(raw):
    strategies = []
    for item in raw.split(','):
        count, separator, seconds = item.strip().lower().partition('x')
        if not separator:
            raise argparse.ArgumentTypeError('전략은 4x30,3x15처럼 입력합니다')
        try:
            value = (int(count), int(seconds))
        except ValueError as error:
            raise argparse.ArgumentTypeError('구간 수와 길이는 정수여야 합니다') from error
        if not 1 <= value[0] <= 8 or value[1] < 1:
            raise argparse.ArgumentTypeError('구간 수는 1~8, 길이는 1초 이상이어야 합니다')
        if value not in strategies:
            strategies.append(value)
    if not strategies:
        raise argparse.ArgumentTypeError('전략이 하나 이상 필요합니다')
    return tuple(strategies)


def percentile(values, percent):
    """표본이 적어도 실제 관측값을 돌려주는 nearest-rank 백분위수."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, -(-len(ordered) * percent // 100))
    return round(ordered[int(rank) - 1], 3)


def summarize(rows):
    summary = []
    strategies = list(dict.fromkeys(row['strategy'] for row in rows))
    for strategy in strategies:
        selected = [row for row in rows if row['strategy'] == strategy]
        successful = [row for row in selected if row['status'] == 'completed']
        totals = [row['estimated_end_to_end_sec'] for row in successful]
        requests = [row['llm_request_sec'] for row in successful]
        summary.append({
            'strategy': strategy,
            'runs': len(selected),
            'successes': len(successful),
            'p50_end_to_end_sec': percentile(totals, 50),
            'p90_end_to_end_sec': percentile(totals, 90),
            'mean_end_to_end_sec': round(statistics.mean(totals), 3) if totals else None,
            'p50_llm_request_sec': percentile(requests, 50),
            'p90_llm_request_sec': percentile(requests, 90),
        })
    return summary


def stage_elapsed(events, stage):
    event = next((value for value in events if value.get('stage') == stage), None)
    return event.get('elapsed_seconds') if event else None


def run_strategy(audio, duration_sec, audio_sha256, strategy, repeat, download_sec,
                 base_config, describe_fn=describe, segment_plan=None):
    count, clip_sec = strategy
    events = []
    config = {**base_config, 'segments': count, 'clip_sec': clip_sec}
    if segment_plan:
        config['segment_plan'] = segment_plan
    started = time.monotonic()
    try:
        result = describe_fn(audio, duration_sec, audio_sha256, config, report=events.append)
        elapsed = round(time.monotonic() - started, 4)
        payload = next((value for value in events if value.get('stage') == 'audio_llm_payload'), {})
        return {
            'strategy': f'{count}x{clip_sec}', 'repeat': repeat, 'status': 'completed',
            'segments': segment_plan, 'clip_extract_sec': stage_elapsed(events, 'audio_llm_clip_extract'),
            'llm_request_sec': stage_elapsed(events, 'audio_llm_request'),
            'audio_bytes': payload.get('audio_bytes'), 'audio_llm_total_sec': elapsed,
            'estimated_end_to_end_sec': round(download_sec + elapsed, 4),
            # 스키마에 따라 없는 필드가 있다. 실험 스키마에는 instruments가 없고
            # 기본 스키마에는 brightness/energy가 없다.
            'description': result['description'], 'mood': result.get('mood', []),
            'instruments': result.get('instruments', []), 'vocal': result.get('vocal', []),
            'brightness': result.get('brightness'), 'energy': result.get('energy'),
            'structure': result.get('structure', []), 'usage': result.get('usage'),
            'generation_id': result.get('generation_id'),
            'prompt_version': result.get('prompt_version'),
        }
    except Exception as error:
        elapsed = round(time.monotonic() - started, 4)
        return {
            'strategy': f'{count}x{clip_sec}', 'repeat': repeat, 'status': 'failed',
            'audio_llm_total_sec': elapsed,
            'estimated_end_to_end_sec': round(download_sec + elapsed, 4),
            'error_type': type(error).__name__,
        }


def rotated(strategies, index):
    offset = index % len(strategies)
    return strategies[offset:] + strategies[:offset]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=['youtube', 'soundcloud'], required=True)
    parser.add_argument('--track-key', required=True, help='YouTube ID 또는 SoundCloud 단일 곡 URL')
    parser.add_argument('--strategies', type=parse_strategies,
                        default=DEFAULT_STRATEGIES, help='기본값: 4x30,3x15,3x10')
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--model', default=os.environ.get('AUDIO_LLM_MODEL', DEFAULT_MODEL))
    parser.add_argument('--timeout-sec', type=int,
                        default=int(os.environ.get('AUDIO_LLM_TIMEOUT_SEC', '180')))
    # 후보 프롬프트를 배포 없이 재 본다. 운영에서 Lab이 넘기는 오버라이드와 같은 경로라
    # (resolve_prompt), 여기서 좋았던 문구를 그대로 Lab에 넣으면 같은 서술이 나온다.
    parser.add_argument('--prompt-file', type=Path,
                        help='시스템 프롬프트 후보 파일. 생략하면 기본 프롬프트를 쓴다')
    # 1단을 빼면 밝기·활력을 아무도 주지 않는다. MAEST(실측 중앙값 76초) 대신
    # Essentia V/A(6초)만 남겨 그 값을 3단 프롬프트에 말로 넣는 안을 재 본다.
    parser.add_argument('--experiment-schema', action='store_true',
                        help='악기 필드를 뺀 스키마로 돌린다')
    parser.add_argument('--with-va', action='store_true',
                        help='Essentia V/A를 계산해 프롬프트에 밝기·활력으로 넣는다')
    parser.add_argument('--va-style', choices=['number', 'label'], default='number',
                        help='V/A를 척도를 붙인 숫자로 넣을지 밴드 이름으로 넣을지')
    # 균등 배치는 인트로와 아웃트로를 항상 포함한다. 운영 경로(remote_analyze)는
    # energy를 쓰므로, 여기서 even을 고르면 그 이전 측정과 비교하는 뜻이 된다.
    parser.add_argument('--sampling', choices=['even', 'energy'], default='even',
                        help='구간을 곡 전체에 균등 배치할지 소리가 큰 쪽에서 고를지')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    api_key = os.environ.get('OPENROUTER_API_KEY', '').strip()
    if not api_key:
        parser.error('OPENROUTER_API_KEY가 필요합니다')
    if args.repeats < 1:
        parser.error('--repeats는 1 이상이어야 합니다')

    prompt = args.prompt_file.read_text(encoding='utf-8').strip() if args.prompt_file else ''
    if args.prompt_file and not prompt:
        parser.error('--prompt-file이 비어 있습니다')

    base_config = {
        'model': args.model,
        'base_url': os.environ.get('OPENROUTER_BASE_URL', DEFAULT_BASE_URL),
        'api_key': api_key,
        'timeout_sec': args.timeout_sec,
        'app_url': os.environ.get('OPENROUTER_APP_URL', ''),
        'app_name': 'Caffeine Flow Audio Benchmark',
        # 빈 문자열이면 resolve_prompt가 기본 프롬프트로 되돌린다.
        'prompt': prompt,
        **({'schema': EXPERIMENT_SCHEMA, 'fields': EXPERIMENT_FIELDS,
            'scores': EXPERIMENT_SCORES} if args.experiment_schema else {}),
    }
    with tempfile.TemporaryDirectory(prefix='caffeine-audio-benchmark-') as directory:
        started = time.monotonic()
        audio = download_audio(args.platform, args.track_key, directory)
        download_sec = round(time.monotonic() - started, 4)
        with wave.open(str(audio), 'rb') as source:
            duration_sec = source.getnframes() / source.getframerate()
        audio_sha256 = file_sha256(audio)

        # 운영 경로와 같이 16kHz 배열을 한 번만 만들어 V/A와 구간 선택이 나눠 쓴다.
        audio_16k = None
        if args.with_va or args.sampling == 'energy':
            import essentia.standard as standard
            audio_16k = standard.MonoLoader(filename=str(audio), sampleRate=16_000)()

        va_sec = None
        va_summary = None
        if args.with_va:
            # 곡당 한 번만 도는 비용이다. 결정론적이라 반복 사이에 값이 바뀌지 않는다.
            from emotion import estimate_valence_arousal, load_emotion_predictor
            started = time.monotonic()
            predictor = load_emotion_predictor(
                os.environ.get('AUDIO_MODEL_DIR', '~/caffeine-audio/models').replace('~', os.path.expanduser('~')))
            summary = estimate_valence_arousal(audio_16k, predictor)
            va_sec = round(time.monotonic() - started, 4)
            if summary:
                base_config['va'] = va_context(summary['valence'], summary['arousal'], args.va_style)
                va_summary = summary
                report_va = {**summary, 'labels': base_config['va'], 'elapsed_sec': va_sec}
            else:
                report_va = {'elapsed_sec': va_sec, 'error': 'V/A 계산 실패'}
            print(json.dumps({'stage': 'valence_arousal', **report_va}, ensure_ascii=False), flush=True)

        # 구간 선택은 결정론적이라 전략당 한 번만 계산하면 반복 사이에 바뀌지 않는다.
        plans = {}
        if args.sampling == 'energy':
            for count, clip_sec in args.strategies:
                plans[(count, clip_sec)] = plan_segments_by_energy(audio_16k, count, clip_sec)
                print(json.dumps({'stage': 'segment_plan', 'strategy': f'{count}x{clip_sec}',
                                  'segments': plans[(count, clip_sec)]}, ensure_ascii=False), flush=True)

        rows = []
        for repeat in range(args.repeats):
            # 항상 같은 전략이 먼저 호출돼 공급자 warm-up 이득을 받지 않도록 순환한다.
            for strategy in rotated(args.strategies, repeat):
                row = run_strategy(audio, duration_sec, audio_sha256, strategy, repeat + 1,
                                   download_sec, base_config, segment_plan=plans.get(strategy))
                rows.append(row)
                print(json.dumps(row, ensure_ascii=False), flush=True)

    report = {
        'created_at': datetime.now(timezone.utc).isoformat(),
        'input': {'platform': args.platform, 'track_key': args.track_key,
                  'source_url': source_url(args.platform, args.track_key),
                  'duration_sec': round(duration_sec, 3)},
        'model': args.model, 'download_sec': download_sec,
        'valence_arousal_sec': va_sec,
        'valence': (va_summary or {}).get('valence'), 'arousal': (va_summary or {}).get('arousal'), 'va_style': args.va_style if args.with_va else None,
        'va_prompt': base_config.get('va'), 'sampling': args.sampling,
        # 어떤 문구로 만든 서술인지 남긴다. 기본은 audio-llm-1, 후보는 custom-<해시>다.
        'prompt_version': next((r.get('prompt_version') for r in rows if r.get('prompt_version')), None),
        'prompt_file': str(args.prompt_file) if args.prompt_file else None,
        'note': 'estimated_end_to_end_sec는 한 번 측정한 다운로드 시간과 각 호출 시간을 합친 값',
        'runs': rows, 'summary': summarize(rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'summary': report['summary']},
                     ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
