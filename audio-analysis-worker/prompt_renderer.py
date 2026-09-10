"""오디오 분석 서비스가 소유한 일반 텍스트 템플릿만 렌더링한다."""
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, StrictUndefined

_ENVIRONMENT = Environment(
    loader=FileSystemLoader(Path(__file__).resolve().parent / 'prompts'),
    undefined=StrictUndefined,
    autoescape=False,
    keep_trailing_newline=True,
    auto_reload=False,
)
_TEMPLATES = frozenset(('audio-description.system.j2', 'audio-description.user.j2'))


def render_prompt(name, **context):
    if name not in _TEMPLATES:
        raise ValueError('등록되지 않은 프롬프트입니다')
    return _ENVIRONMENT.get_template(name).render(**context)
