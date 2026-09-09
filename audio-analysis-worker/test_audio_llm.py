import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import audio_llm
from audio_llm import (
    AudioLLMError,
    SYSTEM_PROMPT,
    build_messages,
    describe,
    parse_response,
    plan_segments,
)


def response(**overrides):
    payload = {'description': '잔잔한 피아노가 이어진다', 'mood': ['차분함'],
               'instruments': ['피아노'], 'vocal': ['보컬 없음'], 'structure': ['후반에 커진다'], **overrides}
    return {'choices': [{'message': {'tool_calls': [
        {'function': {'name': 'describe_audio', 'arguments': json.dumps(payload, ensure_ascii=False)}}]}}]}


class PlanSegmentsTest(unittest.TestCase):
    def test_samples_across_the_whole_track(self):
        segments = plan_segments(200, count=4, clip_sec=30)

        self.assertEqual(len(segments), 4)
        self.assertEqual(segments[0]['start_sec'], 0.0)
        # 인트로만 듣지 않는다. 마지막 구간이 곡 끝에 닿아야 한다.
        self.assertAlmostEqual(segments[-1]['start_sec'] + segments[-1]['duration_sec'], 200, places=2)

    def test_never_runs_past_the_end(self):
        for duration in (12, 45, 61, 300):
            for segment in plan_segments(duration, count=5, clip_sec=30):
                self.assertLessEqual(segment['start_sec'] + segment['duration_sec'], duration + 0.001)

    def test_short_track_gets_one_centered_clip(self):
        self.assertEqual(plan_segments(20, count=4, clip_sec=30),
                         [{'start_sec': 0.0, 'duration_sec': 20.0}])

    def test_no_segments_without_duration(self):
        self.assertEqual(plan_segments(0), [])


class PromptTest(unittest.TestCase):
    def test_prompt_carries_no_genre_or_taxonomy(self):
        # 3단은 1단과 독립이어야 한다. 앵커링되면 앙상블이 아니라 복창이 된다.
        messages = build_messages([b'RIFF0', b'RIFF1'])
        text = json.dumps(messages, ensure_ascii=False)

        for banned in ('MAEST', 'discogs', 'Discogs', 'taxonomy', 'genre_tags', 'Hip Hop---'):
            self.assertNotIn(banned, text, f'프롬프트에 1단 정보가 들어갔다: {banned}')
        self.assertNotIn('---', SYSTEM_PROMPT)

    def test_audio_is_sent_as_audio_not_numbers(self):
        messages = build_messages([b'RIFF0', b'RIFF1'])
        parts = messages[1]['content']

        self.assertEqual([p['type'] for p in parts], ['text', 'input_audio', 'input_audio'])
        self.assertEqual(parts[1]['input_audio']['format'], 'wav')


class ParseResponseTest(unittest.TestCase):
    def test_reads_tool_call_arguments(self):
        parsed = parse_response(response())

        self.assertEqual(parsed['description'], '잔잔한 피아노가 이어진다')
        self.assertEqual(parsed['instruments'], ['피아노'])

    def test_falls_back_to_content(self):
        payload = json.dumps({'description': 'x', 'mood': [], 'instruments': [], 'vocal': [], 'structure': []})
        parsed = parse_response({'choices': [{'message': {'content': payload}}]})

        self.assertEqual(parsed['description'], 'x')

    def test_rejects_empty_or_broken_answers(self):
        for data in ({'choices': [{'message': {}}]},
                     {'choices': [{'message': {'content': 'not json'}}]},
                     response(description='   ')):
            with self.subTest(data=data):
                with self.assertRaises(AudioLLMError):
                    parse_response(data)

    def test_drops_duplicates_and_caps_list_length(self):
        parsed = parse_response(response(mood=['a', 'a', 'b'] + [f'x{i}' for i in range(20)]))

        self.assertEqual(parsed['mood'][:2], ['a', 'b'])
        self.assertLessEqual(len(parsed['mood']), 12)


class DescribeTest(unittest.TestCase):
    def test_builds_raw_with_provenance(self):
        clip = SimpleNamespace(stdout=b'RIFFdata')
        with patch.object(audio_llm, 'call_openrouter', return_value=response()):
            raw = describe('/tmp/a.wav', 200, 'a' * 64,
                           {'model': 'google/gemini-2.5-pro', 'base_url': 'https://x', 'api_key': 'k'},
                           runner=lambda *a, **k: clip)

        self.assertEqual(raw['model_id'], 'google/gemini-2.5-pro')
        self.assertEqual(raw['input_sha256'], 'a' * 64)
        self.assertEqual(raw['prompt_version'], 'audio-llm-1')
        self.assertEqual(len(raw['segments']), 4)
        self.assertIn('created_at', raw)

    def test_clip_extraction_failure_is_reported(self):
        def broken(*_args, **_kwargs):
            raise OSError('ffmpeg missing')

        with self.assertRaises(AudioLLMError):
            describe('/tmp/a.wav', 200, 'a' * 64,
                     {'model': 'm', 'base_url': 'https://x', 'api_key': 'k'}, runner=broken)


if __name__ == '__main__':
    unittest.main()


class UsageTest(unittest.TestCase):
    def test_records_tokens_and_generation_id(self):
        data = response()
        data['id'] = 'gen-abc'
        data['usage'] = {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15, 'cost': 0.01}
        clip = SimpleNamespace(stdout=b'RIFFdata')
        with patch.object(audio_llm, 'call_openrouter', return_value=data):
            raw = describe('/tmp/a.wav', 100, 'a' * 64,
                           {'model': 'm', 'base_url': 'https://x', 'api_key': 'k'},
                           runner=lambda *a, **k: clip)

        # 서버가 세 항목만 허용한다. cost 같은 추가 필드는 걸러 보낸다.
        self.assertEqual(raw['usage'], {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15})
        self.assertEqual(raw['generation_id'], 'gen-abc')

    def test_missing_usage_is_simply_absent(self):
        clip = SimpleNamespace(stdout=b'RIFFdata')
        with patch.object(audio_llm, 'call_openrouter', return_value=response()):
            raw = describe('/tmp/a.wav', 100, 'a' * 64,
                           {'model': 'm', 'base_url': 'https://x', 'api_key': 'k'},
                           runner=lambda *a, **k: clip)

        self.assertNotIn('usage', raw)
        self.assertNotIn('generation_id', raw)
