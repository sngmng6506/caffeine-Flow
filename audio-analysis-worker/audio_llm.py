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

PROMPT_VERSION = 'audio-llm-3'
# 위 버전이 가리키는 기본 본문(system + user)의 해시다. 본문을 고치면
# test_prompt_templates가 여기서 걸린다 — 버전을 안 올리면 DB에 변경 전후 서술이
# 같은 버전으로 섞여 어떤 문장으로 만든 서술인지 되짚을 수 없다. 문구만 고치고
# 기대 문자열만 갱신하면 초록불이 되어버리므로 결정을 강제하는 자리를 따로 둔다.
PROMPT_BODY_SHA256 = '74a3ca1104b24435'
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

# 구간 후보의 에너지 하한. 최고 구간의 이 비율에 못 미치면 고르지 않는다 — 간격을
# 채우려고 무음을 집는 것을 막는다. 제곱평균이라 진폭 기준으로는 약 0.32배다.
QUIET_RATIO = 0.10


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


MIDDLE_SLACK_SEC = 15.0
SELECTION_NOTE = (
    '곡 전체를 고르게 나눈 것이 아니라, 곡을 대표할 만한 자리 두 곳을 골라 뽑았다. '
    '하나는 곡 중앙 30초 안에서 소리가 가장 큰 구간이고, '
    '하나는 곡에서 가장 많이 반복되는 구간(하이라이트로 추정)이다.'
)
MIDDLE_LABEL = '곡 중앙 30초 안에서 소리가 가장 큰 구간'
CHORUS_LABEL = '곡에서 가장 많이 반복되는 구간 (하이라이트로 추정)'


def _window_energy(audio_16k, window, sample_rate):
    """1초 간격으로 본 창 평균 에너지. 순위만 쓰므로 제곱평균이면 충분하다."""
    import numpy as np

    squared = np.square(np.asarray(audio_16k, dtype=np.float64))
    cumulative = np.concatenate(([0.0], np.cumsum(squared)))
    last = len(audio_16k) - window
    starts = np.arange(0, last + 1, max(1, sample_rate))
    return starts, (cumulative[starts + window] - cumulative[starts]) / window


def _loudest_in(audio_16k, window, sample_rate, low, high):
    """[low, high] 안에서 창 에너지가 가장 큰 시작 표본. 비면 None."""
    import numpy as np

    starts, energy = _window_energy(audio_16k, window, sample_rate)
    inside = (starts >= low) & (starts <= high)
    if not inside.any():
        return None
    return int(starts[inside][int(np.argmax(energy[inside]))])


def plan_segments_by_slots(audio_16k, clip_sec=DEFAULT_CLIP_SEC, sample_rate=CLIP_SAMPLE_RATE):
    """역할이 다른 두 구간을 고른다. 시간순으로 돌려준다.

    한 벌의 구간으로 서로 다른 두 문제를 풀 수 없다. 분위기·보컬은 곡을 대표하는
    자리를 들어야 하고, 그래서 여기서는 대표성 쪽으로 몰아 고른다.

    - **중앙 30초 슬롯**: 곡 중앙 ±15초 안에서 창 에너지가 가장 큰 곳. 곡 중앙만
      고정으로 집으면 하필 브레이크다운이나 무음에 떨어진다(실측: 재즈 E0.22,
      trap E0.03). 탐색 여유를 주면 세 곡 모두 E0.91 이상으로 올라간다. 여유를
      ±30초까지 넓히면 "중앙"의 뜻이 사라져 에너지 기반 선택과 같아진다.
    - **하이라이트 슬롯**: 가장 많이 반복되는 구간(chorus.detect_chorus) 안에서
      창 에너지가 가장 큰 곳. 후렴 탐지가 실패하면 이 슬롯은 비운다.

    두 구간이 겹쳐도 밀어내지 않는다. 대표성이 있는 자리를 고르는 것이 목적이라
    인접이 곧 손해는 아니다.

    이 구성은 후렴 밖에 있는 특이 구간을 구조적으로 듣지 못한다. 매장 정책이
    악기를 가리키는데 그 악기가 후렴 밖에만 나오면 놓친다 — 크로마는 음색을 버리고
    중앙 슬롯은 위치가 고정이기 때문이다.
    """
    from chorus import detect_chorus

    total = len(audio_16k) / sample_rate if sample_rate else 0
    if total <= 0:
        return []
    clip = min(float(clip_sec), total)
    window = max(1, int(clip * sample_rate))
    if len(audio_16k) < window:
        return [{'start_sec': 0.0, 'duration_sec': round(total, 3),
                 'label': MIDDLE_LABEL}]

    picked = []
    middle = (len(audio_16k) - window) // 2
    slack = int(MIDDLE_SLACK_SEC * sample_rate)
    start = _loudest_in(audio_16k, window, sample_rate,
                        max(0, middle - slack), middle + slack)
    if start is not None:
        picked.append((start, MIDDLE_LABEL))

    chorus = detect_chorus(audio_16k, sample_rate, clip)
    if chorus is not None:
        low = int(chorus[0] * sample_rate)
        high = min(len(audio_16k) - window, int(chorus[1] * sample_rate) - window)
        start = _loudest_in(audio_16k, window, sample_rate, low, max(low, high))
        if start is not None:
            picked.append((start, CHORUS_LABEL))

    return [{'start_sec': round(value / sample_rate, 3), 'duration_sec': round(clip, 3),
             'label': label}
            for value, label in sorted(picked)]


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

    구간마다 역할이 다른 선택 방식에서는 label로 그 근거를 함께 적는다. 문구는
    탐지 기준을 사실대로 쓴다 — "하이라이트"처럼 해석을 단정하면 검증하지 않은
    음악적 판단을 모델에게 전제로 주게 되고, 판정이 서술을 그대로 따라간다.
    """
    out = []
    for s in (segments or []):
        text = f"{s['start_sec']:.0f}~{s['start_sec'] + s['duration_sec']:.0f}초"
        label = s.get('label') if isinstance(s, dict) else None
        out.append(f'{text} — {label}' if label else text)
    return out


def build_messages(clips, system_prompt=None, va=None, segments=None, selection=None):
    """오디오 구간과 1단 V/A 요약을 담은 메시지. 장르·택소노미·임베딩은 넣지 않는다.

    selection은 구간을 어떤 구성으로 골랐는지 한두 문장으로 알려 준다. 구간마다
    역할이 다르면 개별 label만으로는 조합의 의도가 전달되지 않는다.
    """
    content = [{'type': 'text', 'text': render_prompt(
        'audio-description.user.j2', clip_count=len(clips), va=va,
        segments=segment_ranges(segments), selection=selection)}]
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
    # 구간은 호출부가 정해 넘긴다. 여기서 대신 계획하지 않는 것은 2단이 같은 구간을
    # 들어야 하기 때문이다 — 각자 계획하면 프롬프트의 밝기·활력이 서술과 다른 구간의
    # 값이 된다. 슬롯 선택에는 16kHz 배열이 필요한데 이 함수는 그것을 들고 있지 않다.
    segments = config.get('segment_plan')
    if not segments:
        raise AudioLLMError('샘플 구간을 받지 못했습니다')
    with measure(report, 'audio_llm_clip_extract'):
        clips = [extract_clip(audio_path, segment, config.get('ffmpeg', 'ffmpeg'), runner)
                 for segment in segments]
    if report is not None:
        report({'stage': 'audio_llm_payload', 'status': 'completed',
                'clip_count': len(clips), 'audio_bytes': sum(map(len, clips))})
    system_prompt, prompt_version = resolve_prompt(config.get('prompt'))
    with measure(report, 'audio_llm_request'):
        data = call_openrouter(
            build_messages(clips, system_prompt, config.get('va'), segments,
                           config.get('segment_selection')), config, opener)
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
