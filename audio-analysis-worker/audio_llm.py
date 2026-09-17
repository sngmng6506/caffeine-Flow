"""오디오를 직접 듣는 LLM으로 무드·악기·보컬을 서술받는다(3단).

MAEST(1단)와 **독립적으로** 돈다. 이 모듈은 장르 결과도 택소노미도 받지 않으며,
프롬프트에 넣을 방법 자체를 두지 않는다. 두 단계가 서로를 보고 나면 앙상블이
아니라 한쪽의 복창이 되고, 결과가 갈리는 곡이 "어려운 곡"이라는 신호도 사라진다.

임베딩 벡터를 텍스트로 넣지도 않는다. 오디오 인코더의 잠재공간과 LLM 토큰공간은
정렬돼 있지 않아 숫자를 나열해 봐야 의미가 없다. LLM에는 오디오 자체를 준다.

기본값은 꺼짐이다. 외부 유료 API를 호출하고 오디오 구간이 OpenRouter로 나가므로,
명시적으로 켰을 때만 동작한다.
"""

from prompt_renderer import render_prompt

import base64
import hashlib
import json
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone
from timing import measure

PROMPT_VERSION = 'audio-llm-2'
DEFAULT_MODEL = 'google/gemini-2.5-pro'
DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
# 3x10으로 고정한다. 같은 곡 8회씩 비교한 실측에서 4x30은 E2E P50 34.4초로 20~30초
# 목표를 넘겼고, 3x10은 P50 17.7초·P90 20.3초로 여유 있게 들어왔다. 구간을 더 줄여도
# 이득이 없다 — 호출 시간의 81%가 구간 수와 무관한 고정 비용이라, 구간을 1개로 줄여도
# 13.6초가 11.1초가 될 뿐이다.
DEFAULT_SEGMENTS = 3
DEFAULT_CLIP_SEC = 10
DEFAULT_TIMEOUT_SEC = 180
# 구간만 잘라 보낸다. 곡 전체를 보내면 요금과 지연이 함께 커진다.
CLIP_SAMPLE_RATE = 16000
# 16kHz 모노 무압축 wav는 30초에 938KB, 4구간이면 base64로 4.9MB다. 24kbps mp3로
# 같은 구간이 0.46MB가 된다 — 열 배다. 같은 곡으로 wav와 나란히 호출해 서술·악기·
# 구간 구조가 모두 유지되는 것을 확인했다(호출 시간은 OpenRouter 쪽 변동에 묻혀
# 유의미한 차이가 없었다). 줄어드는 것은 이 미니PC의 업로드 대역이며, 같은 회선을
# CafeStudy ADB 워커가 함께 쓴다.
CLIP_CODEC = 'mp3'
CLIP_BITRATE = '24k'
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

# 1단(MAEST)을 빼는 실험용 스키마. MAEST가 사라지면 valence/arousal을 아무도 주지
# 않는데, 음악 감정 연구에서 이 2축은 사람 사이 일치도가 가장 높은 층위다. 반대로
# 악기 이름은 사람끼리도 잘 안 맞는 층위인데 지금은 그쪽이 판정을 좌우한다(실측:
# 기타로 읽으면 accept, 신스로 읽으면 reject). 그래서 악기를 빼고 2축을 넣는다.
#
# 척도는 0~1이다. 필터의 `밝기`·`활력` 줄과 같은 스케일이라 그대로 들어간다.
EXPERIMENT_FIELDS = ('mood', 'vocal', 'structure')

EXPERIMENT_SCORES = ()

EXPERIMENT_SCHEMA = {
    'type': 'object',
    'properties': {
        'description': {'type': 'string', 'description': '곡 전체에 대한 한국어 자유 서술'},
        'mood': {'type': 'array', 'items': {'type': 'string'}, 'description': '분위기를 나타내는 표현'},
        'vocal': {'type': 'array', 'items': {'type': 'string'}, 'description': '보컬의 유무와 특징'},
        'structure': {'type': 'array', 'items': {'type': 'string'},
                      'description': '제공된 구간을 들어온 순서대로 하나씩 서술한다. 항목 수는 구간 수와 같다'},
    },
    'required': ['description', 'mood', 'vocal', 'structure'],
    'additionalProperties': False,
}

# 밝기·활력은 LLM에게 묻지 않고 Essentia V/A를 말로 바꿔 넣어 준다. 실측에서 LLM은
# 같은 곡에 brightness 0.4~0.8을 내놓아 band() 경계(0.35/0.65)를 넘나들었고, 값도
# 체계적으로 높았다(LLM 0.7/0.8 vs 모델 0.601/0.641). 결정론적 모델이 1.5초면 내는
# 값을 흔들리는 추정으로 대체할 이유가 없다.
#
# 숫자를 그대로 넣되 척도를 같이 알려 준다. MAEST 점수는 "보정되지 않은 상대값"이라
# 숫자가 뜻을 갖지 못하지만 V/A는 다르다 — normalize_score가 DEAM 원본 척도 [1,9]를
# [0,1]로 옮긴 보정된 값이라 0.6은 어디서나 같은 뜻이다. 서버 필터 프롬프트
# (prompt.builder.js의 describeScale)도 같은 형식을 쓴다.
#
# 말로 바꾸면 손실이 크다. 밴드 경계가 0.35/0.65라 valence 0.601과 arousal 0.641이
# 똑같이 "중간"이 되는데, arousal은 "격렬함"에서 0.009 떨어져 있다. 그 차이가 통째로
# 사라진다.
VA_LOW, VA_HIGH = 0.35, 0.65


def va_label(value, low, high):
    """밴드 이름. 숫자 형식과 비교하는 실험(style='label')에서만 쓴다."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    return low if value < VA_LOW else high if value > VA_HIGH else '중간'


def va_context(valence, arousal, style='number'):
    """1단 V/A를 3단 프롬프트에 넣을 문구로 만든다. 없으면 None.

    style='number'면 척도를 붙인 숫자를, 'label'이면 밴드 이름을 준다.
    """
    def render(value, low, high):
        label = va_label(value, low, high)
        if label is None:
            return None
        return label if style == 'label' else f'{value:.2f} (0.00 {low} ~ 1.00 {high})'

    brightness = render(valence, '어두움', '밝음')
    energy = render(arousal, '차분함', '격렬함')
    if not brightness and not energy:
        return None
    return {'brightness': brightness, 'energy': energy}

# 택소노미를 주지 않는다. 선택지를 좁히면 학습 분포 밖 음악(국악, 트로트 등)의
# 정보가 통째로 소실된다. 정규화는 나중에 사람이 보거나 별도 매핑이 한다.
SYSTEM_PROMPT = render_prompt('audio-description.system.j2')


def resolve_prompt(override):
    """운영자가 Lab에서 고친 프롬프트가 있으면 그것을 쓴다.

    어떤 문장으로 만든 서술인지 남겨야 하므로 버전 문자열을 함께 돌려준다.
    본문 자체는 서버 이력에 있으니 결과에는 해시만 넣는다.
    """
    text = override.strip() if isinstance(override, str) else ''
    if not text:
        return SYSTEM_PROMPT, PROMPT_VERSION
    digest = hashlib.sha256(text.encode('utf-8')).hexdigest()[:12]
    return text, f'custom-{digest}'


class AudioLLMError(RuntimeError):
    """3단 호출이 실패했을 때. 1단 결과는 그대로 두고 무드만 비운다."""


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
    """구간 하나를 16kHz 모노 mp3 바이트로 잘라낸다."""
    command = [ffmpeg, '-nostdin', '-loglevel', 'error', '-ss', str(segment['start_sec']),
               '-t', str(segment['duration_sec']), '-i', str(audio_path),
               '-ac', '1', '-ar', str(CLIP_SAMPLE_RATE), '-b:a', CLIP_BITRATE,
               '-f', CLIP_CODEC, 'pipe:1']
    try:
        completed = runner(command, capture_output=True, timeout=120, check=True)
    except (subprocess.SubprocessError, OSError) as error:
        raise AudioLLMError('구간 추출에 실패했습니다') from error
    if not completed.stdout:
        raise AudioLLMError('구간 추출 결과가 비어 있습니다')
    return completed.stdout


def segment_ranges(segments):
    """구간을 '0~10초'처럼 사람이 읽는 표시로 바꾼다.

    모델에게 몇 초 지점을 듣고 있는지 알려 준다. 모르면 구간별로 서술하라고 해도
    무엇을 기준으로 나눠 쓸지 알 수 없다.
    """
    return [f"{s['start_sec']:.0f}~{s['start_sec'] + s['duration_sec']:.0f}초"
            for s in (segments or [])]


def build_messages(clips, system_prompt=None, va=None, segments=None):
    """오디오 구간과 1단 V/A 요약을 담은 메시지. 장르·택소노미·임베딩은 넣지 않는다."""
    content = [{'type': 'text', 'text': render_prompt(
        'audio-description.user.j2', clip_count=len(clips), va=va,
        segments=segment_ranges(segments))}]
    for clip in clips:
        content.append({
            'type': 'input_audio',
            'input_audio': {'data': base64.b64encode(clip).decode('ascii'), 'format': CLIP_CODEC},
        })
    return [{'role': 'system', 'content': system_prompt or SYSTEM_PROMPT},
            {'role': 'user', 'content': content}]


def _clean_text(value, limit=MAX_TEXT):
    return value.strip()[:limit] if isinstance(value, str) else ''


def _clean_score(value):
    """0~1 밖으로 나온 값은 잘라 맞춘다. 서버 필터가 0~1 척도를 전제로 적는다."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    return round(min(1.0, max(0.0, float(value))), 3)


def _clean_items(value):
    if not isinstance(value, list):
        return []
    items = []
    for item in value:
        text = _clean_text(item, MAX_ITEM_TEXT)
        if text and text not in items:
            items.append(text)
    return items[:MAX_ITEMS]


def read_usage(data):
    """토큰 사용량만 골라 남긴다. 요금 추적과 구간 수 조정 판단에 쓴다."""
    usage = data.get('usage')
    if not isinstance(usage, dict):
        return None
    picked = {k: usage[k] for k in ('prompt_tokens', 'completion_tokens', 'total_tokens')
              if isinstance(usage.get(k), int)}
    return picked or None


def parse_response(data, fields=FIELDS, scores=()):
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
    return {'description': description,
            **{field: _clean_items(parsed.get(field)) for field in fields},
            **{score: _clean_score(parsed.get(score)) for score in scores}}


def call_openrouter(messages, config, opener=urllib.request.urlopen):
    body = {
        'model': config['model'],
        'messages': messages,
        'tools': [{'type': 'function',
                   'function': {'name': 'describe_audio', 'description': '들은 내용을 정리한다',
                                'parameters': config.get('schema') or SCHEMA}}],
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
             opener=urllib.request.urlopen, runner=subprocess.run, report=None):
    """구간을 잘라 LLM에 넘기고 보존할 원본을 만든다."""
    segments = plan_segments(duration_sec, config.get('segments', DEFAULT_SEGMENTS),
                             config.get('clip_sec', DEFAULT_CLIP_SEC))
    if not segments:
        raise AudioLLMError('샘플 구간을 만들 수 없습니다')
    with measure(report, 'audio_llm_clip_extract'):
        clips = [extract_clip(audio_path, segment, config.get('ffmpeg', 'ffmpeg'), runner)
                 for segment in segments]
    if report is not None:
        report({'stage': 'audio_llm_payload', 'status': 'completed',
                'clip_count': len(clips), 'audio_bytes': sum(map(len, clips))})
    system_prompt, prompt_version = resolve_prompt(config.get('prompt'))
    with measure(report, 'audio_llm_request'):
        data = call_openrouter(
            build_messages(clips, system_prompt, config.get('va'), segments), config, opener)
    parsed = parse_response(data, config.get('fields') or FIELDS, config.get('scores') or ())
    usage = read_usage(data)
    generation_id = data.get('id') if isinstance(data.get('id'), str) else None
    return {
        'model_id': config['model'],
        'prompt_version': prompt_version,
        'segments': segments,
        'clip_sample_rate': CLIP_SAMPLE_RATE,
        'clip_codec': CLIP_CODEC,
        'input_sha256': audio_sha256,
        'created_at': datetime.now(timezone.utc).isoformat(),
        **({'usage': usage} if usage else {}),
        **({'generation_id': generation_id[:200]} if generation_id else {}),
        **parsed,
    }
