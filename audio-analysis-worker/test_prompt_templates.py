import unittest
from jinja2 import UndefinedError
from audio_llm import build_messages
from prompt_renderer import render_prompt


class PromptTemplateTest(unittest.TestCase):
    def test_preserves_original_text_and_audio(self):
        messages = build_messages([b'RIFF0', b'RIFF1'])
        self.assertEqual(messages[0], {'role': 'system', 'content': (
            '너는 음악을 듣고 묘사하는 사람이다. 주어진 오디오 구간들은 한 곡에서 뽑은 것이다.\n'
            '들리는 것만 쓴다. 곡 제목·아티스트·장르를 추측하지 말고, 확실하지 않으면 그렇게 적는다.\n'
            '분위기, 악기, 보컬, 구간별 변화를 한국어로 서술한다. 정해진 라벨 목록은 없으니 '
            '가장 잘 맞는 표현을 자유롭게 쓴다.'
        )})
        self.assertEqual(messages[1]['content'][0]['text'], '같은 곡에서 뽑은 2개 구간이다.')
        self.assertEqual(messages[1]['content'][1]['input_audio']['data'], 'UklGRjA=')

    def test_missing_variable_and_unregistered_file_fail(self):
        with self.assertRaises(UndefinedError):
            render_prompt('audio-description.user.j2')
        with self.assertRaises(ValueError):
            render_prompt('../audio_llm.py')

    def test_variables_are_not_templates_or_html(self):
        value = '<&> {{ 7 * 7 }}'
        self.assertEqual(render_prompt('audio-description.user.j2', clip_count=value),
                         f'같은 곡에서 뽑은 {value}개 구간이다.')


class PromptVersionTest(unittest.TestCase):
    def test_body_change_forces_a_version_decision(self):
        """기본 본문을 고치면 PROMPT_VERSION을 올릴지 정하게 만든다.

        본문만 바꾸고 버전을 그대로 두면 DB에 변경 전후 서술이 같은 버전으로
        섞여 어떤 문장으로 만든 서술인지 되짚을 수 없다. 위쪽 문구 비교 테스트는
        기대 문자열만 갱신하면 초록불이 되므로 버전 결정을 건너뛸 수 있다.
        """
        import hashlib
        from pathlib import Path
        from audio_llm import PROMPT_BODY_SHA256

        digest = hashlib.sha256()
        folder = Path(__file__).resolve().parent / 'prompts'
        for name in ('audio-description.system.j2', 'audio-description.user.j2'):
            digest.update((folder / name).read_bytes())
        actual = digest.hexdigest()[:16]

        self.assertEqual(
            actual, PROMPT_BODY_SHA256,
            f'기본 본문이 바뀌었다. PROMPT_VERSION(워커)과 BUILTIN_PROMPT_VERSION(서버)을 '
            f'올릴지 정한 뒤 PROMPT_BODY_SHA256을 {actual}로 갱신한다')
