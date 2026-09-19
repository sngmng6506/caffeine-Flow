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
)


# describe는 구간을 스스로 계획하지 않는다(2단이 같은 구간을 들어야 하므로).
PLAN = {'segment_plan': [{'start_sec': 10.0, 'duration_sec': 10.0},
                         {'start_sec': 40.0, 'duration_sec': 10.0}]}


def response(**overrides):
    payload = {'description': '잔잔한 피아노가 이어진다', 'mood': ['차분함'],
               'instruments': ['피아노'], 'vocal': ['보컬 없음'], 'structure': ['후반에 커진다'], **overrides}
    return {'choices': [{'message': {'tool_calls': [
        {'function': {'name': 'describe_audio', 'arguments': json.dumps(payload, ensure_ascii=False)}}]}}]}


class PlanSegmentsBySlotsTest(unittest.TestCase):
    """역할이 다른 두 자리를 고른다 — 곡 중앙의 큰 곳과 가장 많이 반복되는 곳."""

    def repeated_song(self):
        import numpy as np
        # 무음 20초 / A 20초 / 무음 20초 / A 20초(반복) / 무음 20초
        sr = 16000
        phrase = np.sin(np.linspace(0, 400 * np.pi, sr * 20)) * 0.6
        return np.concatenate([np.zeros(sr * 20), phrase,
                               np.zeros(sr * 20), phrase, np.zeros(sr * 20)])

    def test_middle_slot_avoids_a_quiet_centre(self):
        """곡 중앙을 고정으로 집으면 하필 무음에 떨어진다(실측: trap E0.03)."""
        from audio_llm import plan_segments_by_slots, MIDDLE_LABEL
        segments = plan_segments_by_slots(self.repeated_song(), clip_sec=10)
        middle = [s for s in segments if s['label'] == MIDDLE_LABEL]

        self.assertEqual(len(middle), 1)
        start = middle[0]['start_sec']
        self.assertTrue(20 <= start < 40 or 60 <= start < 80,
                        f'조용한 구간을 골랐다: {start}s')

    def test_returns_segments_in_time_order(self):
        """structure 항목이 들어온 순서와 맞아야 한다."""
        from audio_llm import plan_segments_by_slots
        segments = plan_segments_by_slots(self.repeated_song(), clip_sec=10)

        self.assertEqual(segments, sorted(segments, key=lambda v: v['start_sec']))
        self.assertTrue(all(s.get('label') for s in segments), '근거 없는 구간을 보내지 않는다')

    def test_never_runs_past_the_end(self):
        from audio_llm import plan_segments_by_slots
        audio = self.repeated_song()
        total = len(audio) / 16000
        for segment in plan_segments_by_slots(audio, clip_sec=30):
            self.assertLessEqual(segment['start_sec'] + segment['duration_sec'], total + 0.001)

    def test_short_track_gets_one_clip(self):
        import numpy as np
        from audio_llm import plan_segments_by_slots, MIDDLE_LABEL
        segments = plan_segments_by_slots(np.full(16000 * 5, 0.5), clip_sec=10)

        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]['start_sec'], 0.0)
        self.assertEqual(segments[0]['duration_sec'], 5.0)
        self.assertEqual(segments[0]['label'], MIDDLE_LABEL)

    def test_no_segments_without_audio(self):
        import numpy as np
        from audio_llm import plan_segments_by_slots
        self.assertEqual(plan_segments_by_slots(np.zeros(0), clip_sec=10), [])


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
        # 무압축 wav는 4구간에 base64 4.9MB, mp3 24kbps는 0.46MB다. 품질은 같았다.
        self.assertEqual(parts[1]['input_audio']['format'], 'mp3')


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


class ExtractClipTest(unittest.TestCase):
    def test_mp3로_뽑는다(self):
        seen = {}

        def runner(command, **kwargs):
            seen['command'] = command
            return SimpleNamespace(stdout=b'ID3data')

        audio_llm.extract_clip('/tmp/a.wav', {'start_sec': 0, 'duration_sec': 30}, runner=runner)
        self.assertIn('-f', seen['command'])
        self.assertEqual(seen['command'][seen['command'].index('-f') + 1], 'mp3')
        self.assertIn('24k', seen['command'], '비트레이트를 지정해야 크기가 예측된다')


class DescribeTest(unittest.TestCase):
    def test_builds_raw_with_provenance(self):
        clip = SimpleNamespace(stdout=b'RIFFdata')
        with patch.object(audio_llm, 'call_openrouter', return_value=response()):
            raw = describe('/tmp/a.wav', 200, 'a' * 64,
                           {**PLAN, 'model': 'google/gemini-2.5-pro', 'base_url': 'https://x', 'api_key': 'k'},
                           runner=lambda *a, **k: clip)

        self.assertEqual(raw['model_id'], 'google/gemini-2.5-pro')
        self.assertEqual(raw['input_sha256'], 'a' * 64)
        self.assertEqual(raw['prompt_version'], 'audio-llm-3')
        # 기본값은 3x10이다. 숫자를 상수로 빼지 않는 것은 기본값 변경이 이 줄을 고치는
        # 의식적 결정이 되게 하기 위해서다.
        self.assertEqual(len(raw['segments']), 2)
        self.assertIn('created_at', raw)

    def test_reports_clip_and_request_times_without_changing_result(self):
        events = []
        clip = SimpleNamespace(stdout=b'RIFFdata')
        with patch.object(audio_llm, 'call_openrouter', return_value=response()):
            raw = describe('/tmp/a.wav', 100, 'a' * 64,
                           {**PLAN, 'model': 'm', 'base_url': 'https://x', 'api_key': 'k'},
                           runner=lambda *a, **k: clip, report=events.append)

        self.assertEqual(raw['description'], '잔잔한 피아노가 이어진다')
        self.assertEqual([event['stage'] for event in events],
                         ['audio_llm_clip_extract', 'audio_llm_payload', 'audio_llm_request'])
        self.assertEqual(events[1]['audio_bytes'], len(b'RIFFdata') * 2)

    def test_clip_extraction_failure_is_reported(self):
        def broken(*_args, **_kwargs):
            raise OSError('ffmpeg missing')

        with self.assertRaises(AudioLLMError):
            describe('/tmp/a.wav', 200, 'a' * 64,
                     {**PLAN, 'model': 'm', 'base_url': 'https://x', 'api_key': 'k'}, runner=broken)


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
                           {**PLAN, 'model': 'm', 'base_url': 'https://x', 'api_key': 'k'},
                           runner=lambda *a, **k: clip)

        # 서버가 세 항목만 허용한다. cost 같은 추가 필드는 걸러 보낸다.
        self.assertEqual(raw['usage'], {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15})
        self.assertEqual(raw['generation_id'], 'gen-abc')

    def test_missing_usage_is_simply_absent(self):
        clip = SimpleNamespace(stdout=b'RIFFdata')
        with patch.object(audio_llm, 'call_openrouter', return_value=response()):
            raw = describe('/tmp/a.wav', 100, 'a' * 64,
                           {**PLAN, 'model': 'm', 'base_url': 'https://x', 'api_key': 'k'},
                           runner=lambda *a, **k: clip)

        self.assertNotIn('usage', raw)
        self.assertNotIn('generation_id', raw)


class ResolvePromptTest(unittest.TestCase):
    """운영자가 Lab에서 고친 프롬프트를 쓰되, 어떤 문장이었는지 남긴다."""

    def test_없으면_기본_템플릿과_기본_버전(self):
        for override in (None, '', '   ', 42):
            with self.subTest(override=override):
                prompt, version = audio_llm.resolve_prompt(override)
                self.assertEqual(prompt, audio_llm.SYSTEM_PROMPT)
                self.assertEqual(version, audio_llm.PROMPT_VERSION)

    def test_고친_문장은_해시로_버전을_만든다(self):
        prompt, version = audio_llm.resolve_prompt('  들리는 것만 쓴다.  ')
        self.assertEqual(prompt, '들리는 것만 쓴다.')
        self.assertTrue(version.startswith('custom-'))
        self.assertEqual(len(version), len('custom-') + 12)
        # 같은 문장은 같은 버전이어야 옛 서술을 되짚을 수 있다.
        self.assertEqual(version, audio_llm.resolve_prompt('들리는 것만 쓴다.')[1])
        self.assertNotEqual(version, audio_llm.resolve_prompt('다른 문장이다.')[1])

    def test_시스템_메시지에_고친_문장이_들어간다(self):
        messages = audio_llm.build_messages([b'clip'], '매장 배경음으로 맞는지도 적는다.')
        self.assertEqual(messages[0]['content'], '매장 배경음으로 맞는지도 적는다.')
        # 1단 결과를 넣을 통로는 여전히 없다.
        self.assertEqual(messages[1]['content'][1]['type'], 'input_audio')

    def test_describe가_고친_버전을_결과에_남긴다(self):
        clip = SimpleNamespace(stdout=b'RIFFdata')
        seen = {}

        def call(messages, config, opener=None):
            seen['system'] = messages[0]['content']
            return response()

        with patch.object(audio_llm, 'call_openrouter', side_effect=call):
            raw = describe('/tmp/a.wav', 200, 'a' * 64,
                           {**PLAN, 'model': 'm', 'base_url': 'https://x', 'api_key': 'k',
                            'prompt': '고친 문장이다.'},
                           runner=lambda *a, **k: clip)

        self.assertEqual(seen['system'], '고친 문장이다.')
        self.assertEqual(raw['prompt_version'], audio_llm.resolve_prompt('고친 문장이다.')[1])

    def test_프롬프트가_없으면_기본_버전을_남긴다(self):
        clip = SimpleNamespace(stdout=b'RIFFdata')
        with patch.object(audio_llm, 'call_openrouter', return_value=response()):
            raw = describe('/tmp/a.wav', 200, 'a' * 64,
                           {**PLAN, 'model': 'm', 'base_url': 'https://x', 'api_key': 'k'},
                           runner=lambda *a, **k: clip)
        self.assertEqual(raw['prompt_version'], audio_llm.PROMPT_VERSION)


class ChorusDetectionTest(unittest.TestCase):
    """후렴 탐지 포팅본의 안전장치. 실패해도 중앙 슬롯은 남아야 한다."""

    def test_degenerate_audio_returns_none_instead_of_raising(self):
        import numpy as np
        from chorus import detect_chorus
        for name, audio in (
                ('빈 배열', np.zeros(0)),
                ('무음', np.zeros(16000 * 60)),
                ('클립보다 짧은 곡', np.ones(16000) * 0.5),
                ('NaN', np.full(16000 * 60, np.nan)),
                ('inf', np.full(16000 * 60, np.inf))):
            with self.subTest(name=name):
                self.assertIsNone(detect_chorus(audio, 16000, 15))

    def test_frame_count_stays_bounded_on_long_tracks(self):
        """유사도 행렬이 프레임 수의 제곱으로 커진다.

        묶지 않으면 10분 곡에서 denoise가 만드는 n x n 여덟 장만 350MB다. 같은
        자식 프로세스가 감정 모델을 들고 있어 그대로 두면 OOM 위험이 있다.
        """
        import numpy as np
        from chorus import chroma_of, MAX_FRAMES
        # 10분은 계약(audio-pipeline.json)의 길이 상한이다.
        chroma = chroma_of(np.zeros(16000 * 600), 16000)
        self.assertLessEqual(chroma.shape[1], MAX_FRAMES)

    def test_picks_the_repeated_section(self):
        """되풀이되는 화음 진행을 찾아낸다.

        구간 안에서도 화음이 바뀌어야 한다. 한 화음을 길게 끌면 프레임이 전부
        같아져 수평선을 찾을 근거가 사라진다. 반복도 충분히 많아야 한다 —
        선분이 MIN_LINES개는 나와야 임계값 탐색이 멈춘다.
        """
        import numpy as np
        from chorus import detect_chorus
        rng = np.random.default_rng(0)

        def progression(roots, seconds=3):
            parts = []
            for root in roots:
                time = np.linspace(0, seconds, 16000 * seconds, endpoint=False)
                parts.append(sum(np.sin(2 * np.pi * root * ratio * time)
                                 for ratio in (1, 1.26, 1.5)) * 0.2)
            return np.concatenate(parts)

        verse = progression([220, 247, 262, 294])
        hook = progression([330, 294, 262, 220])
        outro = progression([196, 220, 247, 262])
        # verse/hook를 세 번 되풀이하고 끝에만 다른 진행을 둔다(0~72초가 반복부).
        audio = np.concatenate([verse, hook] * 3 + [outro])
        audio = audio + rng.normal(0, 0.002, len(audio))
        found = detect_chorus(audio, 16000, 10)

        self.assertIsNotNone(found, '반복이 뚜렷한 곡에서 후렴을 찾아야 한다')
        self.assertGreaterEqual(found[1] - found[0], 10)
        self.assertLess(found[0], 72, '반복부가 아니라 마지막 진행을 골랐다')
