"""오디오를 직접 듣는 LLM으로 무드·악기·보컬을 서술받는다(2단).

MAEST(1단)와 **독립적으로** 돈다. 이 모듈은 장르 결과도 택소노미도 받지 않으며,
프롬프트에 넣을 방법 자체를 두지 않는다. 두 단계가 서로를 보고 나면 앙상블이
아니라 한쪽의 복창이 되고, 결과가 갈리는 곡이 "어려운 곡"이라는 신호도 사라진다.

임베딩 벡터를 텍스트로 넣지도 않는다. 오디오 인코더의 잠재공간과 LLM 토큰공간은
정렬돼 있지 않아 숫자를 나열해 봐야 의미가 없다. LLM에는 오디오 자체를 준다.

기본값은 꺼짐이다. 외부 유료 API를 호출하고 오디오 구간이 OpenRouter로 나가므로,
명시적으로 켰을 때만 동작한다.
"""

import base64
import json
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone

PROMPT_VERSION = 'audio-llm-1'
DEFAULT_MODEL = 'google/gemini-2.5-pro'
DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
DEFAULT_SEGMENTS = 4
DEFAULT_CLIP_SEC = 30
DEFAULT_TIMEOUT_SEC = 180
# 구간을 16kHz 모노 wav로 잘라 보낸다. 곡 전체를 보내면 요금과 지연이 함께 커진다.
CLIP_SAMPLE_RATE = 16000
MAX_TEXT = 4000
MAX_ITEMS = 12
MAX_ITEM_TEXT = 120

FIELDS = ('mood', 'instruments', 'vocal', 'structure')

SCHEMA = {
    'type': 'object',
    'properties': {
        'description': {'type': 'string', 'description': '곡 전체에 대한 한국어 자유 서술'},
        'mood': {'type': 'array', 'items': {'type': 'string'}, 'description': '분위기를 나타내는 표현'},
        'instruments': {'type': 'array', 'items': {'type': 'string'}, 'description': '들리는 악기'},
        'vocal': {'type': 'array', 'items': {'type': 'string'}, 'description': '보컬의 유무와 특징'},
        'structure': {'type': 'array', 'items': {'type': 'string'}, 'description': '구간별 변화'},
    },
    'required': ['description', 'mood', 'instruments', 'vocal', 'structure'],
    'additionalProperties': False,
}

# 택소노미를 주지 않는다. 선택지를 좁히면 학습 분포 밖 음악(국악, 트로트 등)의
# 정보가 통째로 소실된다. 정규화는 나중에 사람이 보거나 별도 매핑이 한다.
SYSTEM_PROMPT = (
    '너는 음악을 듣고 묘사하는 사람이다. 주어진 오디오 구간들은 한 곡에서 고르게 뽑은 것이다.\n'
    '들리는 것만 쓴다. 곡 제목·아티스트·장르를 추측하지 말고, 확실하지 않으면 그렇게 적는다.\n'
    '분위기, 악기, 보컬, 구간별 변화를 한국어로 서술한다. 정해진 라벨 목록은 없으니 '
    '가장 잘 맞는 표현을 자유롭게 쓴다.'
)


class AudioLLMError(RuntimeError):
    """2단 호출이 실패했을 때. 1단 결과는 그대로 두고 무드만 비운다."""


def plan_segments(duration_sec, count=DEFAULT_SEGMENTS, clip_sec=DEFAULT_CLIP_SEC):
    """곡 전체를 고르게 나눠 샘플 구간을 정한다.

    인트로만 듣지 않기 위해서다. 구간이 곡 길이를 넘지 않도록 잘라 맞춘다.
    """
    if duration_sec <= 0 or count < 1:
        return []
    count = max(1, min(int(count), 8))
    clip = min(float(clip_sec), duration_sec)
    if count == 1:
        return [{'start_sec': round(max(0.0, (duration_sec - clip) / 2), 3), 'duration_sec': round(clip, 3)}]
    # 각 구간의 시작점을 균등 배치하고, 마지막 구간이 곡 끝을 넘지 않게 한다.
    last_start = max(0.0, duration_sec - clip)
    step = last_start / (count - 1)
    starts = [round(i * step, 3) for i in range(count)]
    unique = sorted(set(starts))
    return [{'start_sec': s, 'duration_sec': round(clip, 3)} for s in unique]


def extract_clip(audio_path, segment, ffmpeg='ffmpeg', runner=subprocess.run):
    """구간 하나를 16kHz 모노 wav 바이트로 잘라낸다."""
    command = [ffmpeg, '-nostdin', '-loglevel', 'error', '-ss', str(segment['start_sec']),
               '-t', str(segment['duration_sec']), '-i', str(audio_path),
               '-ac', '1', '-ar', str(CLIP_SAMPLE_RATE), '-f', 'wav', 'pipe:1']
    try:
        completed = runner(command, capture_output=True, timeout=120, check=True)
    except (subprocess.SubprocessError, OSError) as error:
        raise AudioLLMError('구간 추출에 실패했습니다') from error
    if not completed.stdout:
        raise AudioLLMError('구간 추출 결과가 비어 있습니다')
    return completed.stdout


def build_messages(clips):
    """오디오 구간만 담은 메시지. 장르·택소노미·임베딩은 넣지 않는다."""
    content = [{'type': 'text', 'text': f'같은 곡에서 고르게 뽑은 {len(clips)}개 구간이다.'}]
    for clip in clips:
        content.append({
            'type': 'input_audio',
            'input_audio': {'data': base64.b64encode(clip).decode('ascii'), 'format': 'wav'},
        })
    return [{'role': 'system', 'content': SYSTEM_PROMPT}, {'role': 'user', 'content': content}]


def _clean_text(value, limit=MAX_TEXT):
    return value.strip()[:limit] if isinstance(value, str) else ''


def _clean_items(value):
    if not isinstance(value, list):
        return []
    items = []
    for item in value:
        text = _clean_text(item, MAX_ITEM_TEXT)
        if text and text not in items:
            items.append(text)
    return items[:MAX_ITEMS]


def parse_response(data):
    """tool call 우선, content fallback. 자유 서술이 비면 실패로 본다."""
    message = (data.get('choices') or [{}])[0].get('message') or {}
    raw = None
    calls = message.get('tool_calls') or []
    if calls:
        raw = (calls[0].get('function') or {}).get('arguments')
    raw = raw or message.get('content')
    if not raw:
        raise AudioLLMError('LLM 응답이 비어 있습니다')
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError as error:
        raise AudioLLMError('LLM 응답을 읽을 수 없습니다') from error
    if not isinstance(parsed, dict):
        raise AudioLLMError('LLM 응답 형식이 올바르지 않습니다')
    description = _clean_text(parsed.get('description'))
    if not description:
        raise AudioLLMError('자유 서술이 비어 있습니다')
    return {'description': description, **{field: _clean_items(parsed.get(field)) for field in FIELDS}}


def call_openrouter(messages, config, opener=urllib.request.urlopen):
    body = {
        'model': config['model'],
        'messages': messages,
        'tools': [{'type': 'function',
                   'function': {'name': 'describe_audio', 'description': '들은 내용을 정리한다',
                                'parameters': SCHEMA}}],
        'tool_choice': {'type': 'function', 'function': {'name': 'describe_audio'}},
    }
    request = urllib.request.Request(
        config['base_url'].rstrip('/') + '/chat/completions',
        data=json.dumps(body).encode('utf-8'),
        headers={'Authorization': f"Bearer {config['api_key']}",
                 'Content-Type': 'application/json',
                 'HTTP-Referer': config.get('app_url', ''),
                 'X-Title': config.get('app_name', 'Caffeine Flow')},
        method='POST')
    try:
        with opener(request, timeout=config.get('timeout_sec', DEFAULT_TIMEOUT_SEC)) as response:
            return json.loads(response.read().decode('utf-8'))
    except (urllib.error.URLError, OSError, ValueError) as error:
        # 외부 응답 본문에는 키가 섞일 수 있으므로 고정 문구만 남긴다.
        raise AudioLLMError('LLM 호출에 실패했습니다') from error


def describe(audio_path, duration_sec, audio_sha256, config,
             opener=urllib.request.urlopen, runner=subprocess.run):
    """구간을 잘라 LLM에 넘기고 보존할 원본을 만든다."""
    segments = plan_segments(duration_sec, config.get('segments', DEFAULT_SEGMENTS),
                             config.get('clip_sec', DEFAULT_CLIP_SEC))
    if not segments:
        raise AudioLLMError('샘플 구간을 만들 수 없습니다')
    clips = [extract_clip(audio_path, segment, config.get('ffmpeg', 'ffmpeg'), runner)
             for segment in segments]
    parsed = parse_response(call_openrouter(build_messages(clips), config, opener))
    return {
        'model_id': config['model'],
        'prompt_version': PROMPT_VERSION,
        'segments': segments,
        'clip_sample_rate': CLIP_SAMPLE_RATE,
        'input_sha256': audio_sha256,
        'created_at': datetime.now(timezone.utc).isoformat(),
        **parsed,
    }
