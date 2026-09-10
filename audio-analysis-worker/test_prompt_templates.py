import unittest
from jinja2 import UndefinedError
from audio_llm import build_messages
from prompt_renderer import render_prompt


class PromptTemplateTest(unittest.TestCase):
    def test_preserves_original_text_and_audio(self):
        messages = build_messages([b'RIFF0', b'RIFF1'])
        self.assertEqual(messages[0], {'role': 'system', 'content': (
            '너는 음악을 듣고 묘사하는 사람이다. 주어진 오디오 구간들은 한 곡에서 고르게 뽑은 것이다.\n'
            '들리는 것만 쓴다. 곡 제목·아티스트·장르를 추측하지 말고, 확실하지 않으면 그렇게 적는다.\n'
            '분위기, 악기, 보컬, 구간별 변화를 한국어로 서술한다. 정해진 라벨 목록은 없으니 '
            '가장 잘 맞는 표현을 자유롭게 쓴다.'
        )})
        self.assertEqual(messages[1]['content'][0]['text'], '같은 곡에서 고르게 뽑은 2개 구간이다.')
        self.assertEqual(messages[1]['content'][1]['input_audio']['data'], 'UklGRjA=')

    def test_missing_variable_and_unregistered_file_fail(self):
        with self.assertRaises(UndefinedError):
            render_prompt('audio-description.user.j2')
        with self.assertRaises(ValueError):
            render_prompt('../audio_llm.py')

    def test_variables_are_not_templates_or_html(self):
        value = '<&> {{ 7 * 7 }}'
        self.assertEqual(render_prompt('audio-description.user.j2', clip_count=value),
                         f'같은 곡에서 고르게 뽑은 {value}개 구간이다.')
