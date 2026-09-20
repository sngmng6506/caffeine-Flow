"""신청 시점 분석 경로(Valence/Arousal + Audio LLM)의 계약."""
import unittest
import numpy as np
from unittest.mock import patch
from labels import normalize, make_annotation
from emotion import EmotionModelError


def repeated_audio(seconds=120):
    """같은 악절이 두 번 나오는 합성 신호. 후렴 탐지가 붙을 거리를 준다."""
    phrase = np.sin(np.linspace(0, 400 * np.pi, 16000 * 20)) * 0.6
    quiet = np.zeros(16000 * 20)
    return np.concatenate([quiet, phrase, quiet, phrase, quiet, phrase])


class RemoteResultTest(unittest.TestCase):
    def test_remote_result_contains_input_hash_and_no_audio_llm(self):
        import tempfile
        from pathlib import Path
        import remote_analyze
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'input.wav'
            import wave
            with wave.open(str(audio), 'wb') as output:
                output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                output.writeframes(b'\0\0' * 16000 * 20)
            with patch.object(remote_analyze, 'analyze_for_judgement', return_value=({'duration_seconds': 20, 'sample_rate': 16000}, 'test')):
                result = remote_analyze.run(audio, {'platform': 'youtube', 'track_key': 'abcdefghijk', 'artist_name': 'unknown'}, Path(directory) / 'result.json')
            self.assertEqual(len(result['analysis_run']['audio_sha256']), 64)
            self.assertIsNone(result['analysis_run']['audio_llm_raw'])
            self.assertIsNone(result['analysis_run']['audio_local_path'])
            self.assertEqual(result['analysis_run']['pipeline_mode'], 'EMOTION_LLM')


class MoodNormalizeTest(unittest.TestCase):
    def test_mood_is_none_without_valence_arousal(self):
        self.assertIsNone(normalize(features={'bpm': 100})['mood'])
        self.assertIsNone(normalize(features={'valence': 0.5, 'arousal': None})['mood'])

    def test_mood_carries_scores_and_source(self):
        mood = normalize(features={'valence': 0.7, 'arousal': 0.7})['mood']

        self.assertEqual(mood['valence'], 0.7)
        self.assertEqual(mood['arousal'], 0.7)
        self.assertEqual(mood['source'], 'deam-msd-musicnn-2')
        self.assertEqual(mood['tags'], ['joyful', 'uplifting'])

    def test_annotation_uses_mood_tags_when_present(self):
        features = {'bpm': 100, 'valence': 0.7, 'arousal': 0.7}
        normalized = normalize(features=features)

        self.assertEqual(make_annotation(features, normalized)['mood_tags'], ['joyful', 'uplifting'])

    def test_annotation_stays_unknown_without_mood(self):
        # 감정값이 없으면 장르에서 분위기를 추측하지 않는다.
        normalized = normalize(features={'bpm': 100})

        self.assertEqual(make_annotation({'bpm': 100}, normalized)['mood_tags'], ['unknown'])

    def test_mid_range_scores_produce_no_mood_tag(self):
        # 애매한 곡에 억지로 분위기를 붙이지 않는다(실측: 엘리제를 위하여 0.44/0.45).
        mood = normalize(features={'valence': 0.44, 'arousal': 0.45})['mood']

        self.assertEqual(mood['tags'], [])
        self.assertEqual(mood['valence'], 0.44)

    def test_remote_result_records_emotion_stage_when_it_runs(self):
        import tempfile, wave
        from pathlib import Path
        import remote_analyze
        features = {'duration_seconds': 20, 'sample_rate': 16000, 'valence': 0.7, 'arousal': 0.7}
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'input.wav'
            with wave.open(str(audio), 'wb') as output:
                output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                output.writeframes(b'\0\0' * 16000 * 20)
            with patch.object(remote_analyze, 'load_emotion_predictor', return_value=lambda a: None), \
                 patch.object(remote_analyze, 'load_audio', return_value=[0.0]), \
                 patch.object(remote_analyze, 'analyze_for_judgement', return_value=(features, 'test')):
                result = remote_analyze.run(audio, {'platform': 'youtube', 'track_key': 'abcdefghijk',
                                                    'artist_name': 'unknown'}, Path(directory) / 'result.json')
            run_data = result['analysis_run']
            self.assertEqual(run_data['pipeline_mode'], 'EMOTION_LLM')
            self.assertEqual(run_data['sources_used'], ['msd-musicnn-1', 'deam-msd-musicnn-2'])
            self.assertEqual(run_data['normalized']['mood']['tags'], ['joyful', 'uplifting'])
            self.assertEqual(result['automatic_annotation']['mood_tags'], ['joyful', 'uplifting'])


class PipelineModeTest(unittest.TestCase):
    def test_valence_arousal_reaches_the_audio_llm(self):
        """2단 V/A가 3단 프롬프트까지 간다.

        저장만 되고 소비처로 오지 않는 필드가 이미 한 번 있었다(structure). 배선은
        조용히 끊기고 테스트가 없으면 드러나지 않는다. 3단이 2단 뒤에 출발해야
        넘길 값이 생기므로 순서를 되돌리면 여기서 걸린다.
        """
        import tempfile, wave, os
        from pathlib import Path
        import remote_analyze
        from audio_llm import AudioLLMError
        seen = {}

        def describe(_audio, _duration, _sha, config, **_kwargs):
            seen['va'] = config.get('va')
            raise AudioLLMError('stop here')

        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'input.wav'
            with wave.open(str(audio), 'wb') as output:
                output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                output.writeframes(b'\0\0' * 16000 * 20)
            features = {'duration_seconds': 20, 'valence': 0.12, 'arousal': 0.91}
            with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test'}), \
                 patch.object(remote_analyze, 'load_emotion_predictor', return_value=lambda a: None), \
                 patch.object(remote_analyze, 'load_audio', return_value=repeated_audio()), \
                 patch.object(remote_analyze, 'analyze_for_judgement', return_value=(features, 'test')), \
                 patch.object(remote_analyze, 'describe', side_effect=describe):
                remote_analyze.run(audio, {'platform': 'youtube', 'track_key': 'abcdefghijk',
                                           'artist_name': 'unknown', 'audio_llm_enabled': True},
                                   Path(directory) / 'result.json')

        # 숫자를 척도와 함께 넘긴다. 밴드 이름으로 뭉개면 0.12와 0.34가 같아진다.
        self.assertIsNotNone(seen['va'], 'V/A가 3단 설정에 실리지 않았다')
        self.assertIn('0.12', seen['va']['brightness'])
        self.assertIn('0.91', seen['va']['energy'])

    def test_clip_length_setting_reaches_the_plan(self):
        """AUDIO_LLM_CLIP_SEC가 실제 구간 계획에 반영된다.

        구간은 3단보다 먼저 정해진다(2단이 같은 구간을 듣는다). describe는 넘겨받은
        계획을 그대로 쓰므로, 계획을 세울 때 설정을 읽지 않으면 환경변수를 바꿔도
        기본값 그대로 돈다 — 조용히 무시되는 설정이 된다.
        """
        import tempfile, wave, os
        from pathlib import Path
        import remote_analyze
        from audio_llm import AudioLLMError
        seen = {}

        def describe(_audio, _duration, _sha, config, **_kwargs):
            seen['plan'] = config.get('segment_plan')
            raise AudioLLMError('stop here')

        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'input.wav'
            with wave.open(str(audio), 'wb') as output:
                output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                output.writeframes(b'\0\0' * 16000 * 120)
            features = {'duration_seconds': 120, 'valence': 0.5, 'arousal': 0.5}
            with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test',
                                         'AUDIO_LLM_CLIP_SEC': '20'}), \
                 patch.object(remote_analyze, 'load_emotion_predictor', return_value=lambda a: None), \
                 patch.object(remote_analyze, 'load_audio', return_value=repeated_audio()), \
                 patch.object(remote_analyze, 'analyze_for_judgement', return_value=(features, 'test')), \
                 patch.object(remote_analyze, 'describe', side_effect=describe):
                remote_analyze.run(audio, {'platform': 'youtube', 'track_key': 'abcdefghijk',
                                           'artist_name': 'unknown', 'audio_llm_enabled': True},
                                   Path(directory) / 'result.json')

        self.assertTrue(seen['plan'], '구간 계획이 비었다')
        self.assertTrue(all(segment['duration_sec'] == 20 for segment in seen['plan']))

    def test_llm_failure_does_not_lose_the_rest_of_the_analysis(self):
        """3단이 실패해도 특징값과 무드는 저장된다.

        예전에는 3단이 MAEST와 겹쳐 돌았고 이 테스트가 그 동시성까지 확인했다.
        MAEST를 빼면서 겹칠 CPU 작업이 없어져 3단은 2단 뒤에 홀로 돈다 — 동시성
        검사는 지켰던 대상이 사라졌으므로 함께 지웠다. 남은 것은 가드레일이 요구하는
        "3단 실패가 나머지 저장을 막지 않는다"이다.
        """
        import tempfile, wave, os
        from pathlib import Path
        import remote_analyze
        from audio_llm import AudioLLMError

        def describe(*args, **kwargs):
            raise AudioLLMError('unavailable')

        features = {'duration_seconds': 20, 'valence': 0.7, 'arousal': 0.7}
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'input.wav'
            with wave.open(str(audio), 'wb') as output:
                output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                output.writeframes(b'\0\0' * 16000 * 20)
            with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test'}), \
                 patch.object(remote_analyze, 'load_emotion_predictor', return_value=lambda a: None), \
                 patch.object(remote_analyze, 'load_audio', return_value=[0.0]), \
                 patch.object(remote_analyze, 'analyze_for_judgement', return_value=(features, 'test')), \
                 patch.object(remote_analyze, 'describe', side_effect=describe):
                result = remote_analyze.run(audio, {'platform': 'youtube', 'track_key': 'abcdefghijk',
                    'artist_name': 'unknown', 'audio_llm_enabled': True}, Path(directory) / 'result.json')
            self.assertIsNone(result['analysis_run']['audio_llm_raw'])
            self.assertEqual(result['analysis_run']['normalized']['mood']['tags'], ['joyful', 'uplifting'])

    def test_mode_is_emotion_llm(self):
        """신청 시점 경로가 도는 단계는 하나뿐이다.

        장르를 판단할 모델이 없으므로 분기할 모드도 없다. 모드를 늘리려면 실제로
        도는 단계를 먼저 늘려야 한다.
        """
        from remote_analyze import pipeline_mode
        self.assertEqual(pipeline_mode(), 'EMOTION_LLM')

    def test_audio_llm_follows_the_server_setting(self):
        # 3단 실행 여부는 서버가 정한다. 워커 환경변수로 되돌리면 운영자가 Lab에서
        # 끄지 못하게 된다.
        import tempfile, wave, os
        from pathlib import Path
        import remote_analyze
        features = {'duration_seconds': 20, 'sample_rate': 16000}
        calls = []

        def build(job_extra, key='k'):
            calls.clear()
            with tempfile.TemporaryDirectory() as directory:
                audio = Path(directory) / 'input.wav'
                with wave.open(str(audio), 'wb') as output:
                    output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                    output.writeframes(b'\0\0' * 16000 * 20)
                with patch.dict(os.environ, {'OPENROUTER_API_KEY': key}), \
                     patch.object(remote_analyze, 'load_audio', return_value=repeated_audio()), \
                     patch.object(remote_analyze, 'analyze_for_judgement', return_value=(features, 'test')), \
                     patch.object(remote_analyze, 'describe',
                                  side_effect=lambda *a, **k: calls.append(a) or {
                                      'model_id': 'm', 'description': 'x'}):
                    job = {'platform': 'youtube', 'track_key': 'abcdefghijk',
                           'artist_name': 'unknown', **job_extra}
                    return remote_analyze.run(audio, job, Path(directory) / 'result.json')

        self.assertIsNotNone(build({'audio_llm_enabled': True})['analysis_run']['audio_llm_raw'])
        self.assertEqual(len(calls), 1)

        self.assertIsNone(build({'audio_llm_enabled': False})['analysis_run']['audio_llm_raw'])
        self.assertEqual(calls, [], '서버가 껐으면 호출하지 않는다')

        # 키가 없으면 서버가 켜 두어도 건너뛴다. 기동을 막지는 않는다.
        self.assertIsNone(build({'audio_llm_enabled': True}, key='')['analysis_run']['audio_llm_raw'])
        self.assertEqual(calls, [])
