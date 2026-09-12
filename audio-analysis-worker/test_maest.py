import unittest
import numpy as np
from unittest.mock import patch
from maest import summarize, normalize, make_annotation, CLASSES
from emotion import EmotionModelError


class MaestTest(unittest.TestCase):
    def test_server_and_worker_normalization_match(self):
        import shutil
        import subprocess
        import json
        from pathlib import Path
        if not shutil.which('node'):
            self.skipTest('교차 언어 계약 검증에는 Node가 필요합니다')
        raw = summarize(np.array([[((i * 7) % 101) / 100 for i in range(519)]]), 20)
        server = Path(__file__).resolve().parents[1] / 'server/src/features/audio-analysis/normalization.js'
        script = "const {normalize}=require(process.argv[1]);let s='';process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>console.log(JSON.stringify(normalize(JSON.parse(s)))));"
        result = subprocess.run(['node', '-e', script, str(server)], input=json.dumps(raw), text=True, capture_output=True, check=True)
        self.assertEqual(normalize(raw), json.loads(result.stdout))

    def test_full_scores_mean_max_and_tail(self):
        scores = np.zeros((3, 1, 519))
        i = CLASSES.index('Jazz---Big Band')
        scores[:, 0, i] = [0.2, 0.8, 0.5]
        raw = summarize(scores, 42)
        self.assertEqual(len(raw['mean']), 519)
        self.assertAlmostEqual(raw['mean'][i], 0.5)
        self.assertEqual(raw['max'][i], 0.8)
        self.assertEqual(raw['segments'][-1]['end_sec'], 42)
        self.assertAlmostEqual(raw['segments'][1]['start_sec'], 15.008)

    def test_bad_output_cannot_silently_drop_a_segment(self):
        for frames in [[], np.zeros((1, 400)), np.full((1, 519), np.nan), np.full((1, 519), 1.1)]:
            with self.assertRaises(EmotionModelError): summarize(frames, 30)

    def test_genre_never_fills_mood_vocal_or_instrumentation(self):
        values = np.zeros((1, 519))
        values[0, CLASSES.index('Hip Hop---Trap')] = 0.8
        normalized = normalize(summarize(values, 20))
        label = make_annotation({'bpm': 140, 'valence': 0.8, 'arousal': 0.8}, normalized)
        self.assertEqual(label['genre_tags'], ['hiphop_rap'])
        self.assertEqual(label['mood_tags'], ['unknown'])
        self.assertEqual(label['vocal_type'], 'unknown')
        self.assertEqual(label['instrumentation_type'], 'unknown')
        self.assertIsNone(normalized['mood'])

    def test_low_secondary_style_is_not_forced_by_kpop(self):
        values = np.zeros((1, 519))
        values[0, CLASSES.index('Pop---K-pop')] = 0.974
        values[0, CLASSES.index('Pop---Ballad')] = 0.109
        raw = summarize(values, 20)
        self.assertEqual([v['label'] for v in normalize(raw)['genre']], ['pop'])
        # 원본 재추론 없이 외부 매핑·임계값 변경만으로 파생 태그를 재생성한다.
        import json
        from maest import ROOT
        taxonomy = json.loads((ROOT / 'music-taxonomy.json').read_text())
        taxonomy['thresholds']['Pop---Ballad'] = 0.1
        self.assertEqual([v['label'] for v in normalize(raw, taxonomy)['genre']], ['pop', 'ballad'])

    def test_remote_result_contains_input_hash_and_no_audio_llm(self):
        import tempfile
        from pathlib import Path
        import remote_analyze
        raw = summarize(np.zeros((1, 519)), 20)
        raw['essentia_version'] = 'test'
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'input.wav'
            import wave
            with wave.open(str(audio), 'wb') as output:
                output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                output.writeframes(b'\0\0' * 16000 * 20)
            with patch.object(remote_analyze, 'analyze_audio', return_value=({'duration_seconds': 20, 'sample_rate': 16000}, 'test')), patch.object(remote_analyze, 'predict', return_value=raw):
                result = remote_analyze.run(audio, {'platform': 'youtube', 'track_key': 'abcdefghijk', 'artist_name': 'unknown'}, Path(directory) / 'result.json')
            self.assertEqual(len(result['maest_run']['audio_sha256']), 64)
            self.assertIsNone(result['maest_run']['audio_llm_raw'])
            self.assertIsNone(result['maest_run']['audio_local_path'])
            self.assertEqual(result['maest_run']['pipeline_mode'], 'MAEST_ONLY')


class MoodNormalizeTest(unittest.TestCase):
    def test_mood_is_none_without_valence_arousal(self):
        raw = {'classes': CLASSES, 'mean': [0.0] * len(CLASSES)}
        self.assertIsNone(normalize(raw, features={'bpm': 100})['mood'])
        self.assertIsNone(normalize(raw, features={'valence': 0.5, 'arousal': None})['mood'])

    def test_mood_carries_scores_and_source(self):
        raw = {'classes': CLASSES, 'mean': [0.0] * len(CLASSES)}
        mood = normalize(raw, features={'valence': 0.7, 'arousal': 0.7})['mood']

        self.assertEqual(mood['valence'], 0.7)
        self.assertEqual(mood['arousal'], 0.7)
        self.assertEqual(mood['source'], 'deam-msd-musicnn-2')
        self.assertEqual(mood['tags'], ['joyful', 'uplifting'])

    def test_annotation_uses_mood_tags_when_present(self):
        raw = {'classes': CLASSES, 'mean': [0.0] * len(CLASSES)}
        features = {'bpm': 100, 'valence': 0.7, 'arousal': 0.7}
        normalized = normalize(raw, features=features)

        self.assertEqual(make_annotation(features, normalized)['mood_tags'], ['joyful', 'uplifting'])

    def test_annotation_stays_unknown_without_mood(self):
        # 감정값이 없으면 장르에서 분위기를 추측하지 않는다.
        raw = {'classes': CLASSES, 'mean': [0.0] * len(CLASSES)}
        normalized = normalize(raw, features={'bpm': 100})

        self.assertEqual(make_annotation({'bpm': 100}, normalized)['mood_tags'], ['unknown'])

    def test_mid_range_scores_produce_no_mood_tag(self):
        # 애매한 곡에 억지로 분위기를 붙이지 않는다(실측: 엘리제를 위하여 0.44/0.45).
        raw = {'classes': CLASSES, 'mean': [0.0] * len(CLASSES)}
        mood = normalize(raw, features={'valence': 0.44, 'arousal': 0.45})['mood']

        self.assertEqual(mood['tags'], [])
        self.assertEqual(mood['valence'], 0.44)

    def test_remote_result_records_emotion_stage_when_it_runs(self):
        import tempfile, wave
        from pathlib import Path
        import remote_analyze
        raw = summarize(np.zeros((1, 519)), 20)
        raw['essentia_version'] = 'test'
        features = {'duration_seconds': 20, 'sample_rate': 16000, 'valence': 0.7, 'arousal': 0.7}
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'input.wav'
            with wave.open(str(audio), 'wb') as output:
                output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                output.writeframes(b'\0\0' * 16000 * 20)
            with patch.object(remote_analyze, 'load_emotion_predictor', return_value=lambda a: None), \
                 patch.object(remote_analyze, 'load_audio', return_value=[0.0]), \
                 patch.object(remote_analyze, 'analyze_audio', return_value=(features, 'test')), \
                 patch.object(remote_analyze, 'predict', return_value=raw):
                result = remote_analyze.run(audio, {'platform': 'youtube', 'track_key': 'abcdefghijk',
                                                    'artist_name': 'unknown'}, Path(directory) / 'result.json')
            run_data = result['maest_run']
            self.assertEqual(run_data['pipeline_mode'], 'MAEST_EMOTION')
            self.assertEqual(run_data['sources_used'],
                             ['discogs-maest-30s-pw-519l-2', 'msd-musicnn-1', 'deam-msd-musicnn-2'])
            self.assertEqual(run_data['normalized']['mood']['tags'], ['joyful', 'uplifting'])
            self.assertEqual(result['automatic_annotation']['mood_tags'], ['joyful', 'uplifting'])


class PipelineModeTest(unittest.TestCase):
    def test_llm_overlaps_cpu_and_failure_preserves_maest(self):
        import tempfile, wave, os, threading
        from pathlib import Path
        import remote_analyze
        from audio_llm import AudioLLMError
        started, cpu_done = threading.Event(), threading.Event()
        raw = summarize(np.zeros((1, 519)), 20)
        raw['essentia_version'] = 'test'

        def describe(*args):
            started.set()
            if not cpu_done.wait(3):
                raise AssertionError('CPU 분석과 겹쳐 실행되어야 한다')
            raise AudioLLMError('unavailable')

        def predict(*args, **kwargs):
            self.assertTrue(started.wait(3))
            cpu_done.set()
            return raw

        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'input.wav'
            with wave.open(str(audio), 'wb') as output:
                output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                output.writeframes(b'\0\0' * 16000 * 20)
            with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test'}), \
                 patch.object(remote_analyze, 'load_emotion_predictor', side_effect=EmotionModelError()), \
                 patch.object(remote_analyze, 'analyze_audio', return_value=({'duration_seconds': 20}, 'test')), \
                 patch.object(remote_analyze, 'predict', side_effect=predict), \
                 patch.object(remote_analyze, 'describe', side_effect=describe):
                result = remote_analyze.run(audio, {'platform': 'youtube', 'track_key': 'abcdefghijk',
                    'artist_name': 'unknown'}, Path(directory) / 'result.json')
            self.assertIsNone(result['maest_run']['audio_llm_raw'])
            self.assertEqual(result['maest_run']['maest_raw'], raw)

    def test_mode_reflects_which_stages_ran(self):
        from remote_analyze import pipeline_mode
        mood = {'valence': 0.5, 'arousal': 0.5}
        llm = {'model_id': 'google/gemini-2.5-pro'}

        self.assertEqual(pipeline_mode(None, None), 'MAEST_ONLY')
        self.assertEqual(pipeline_mode(mood, None), 'MAEST_EMOTION')
        self.assertEqual(pipeline_mode(mood, llm), 'FULL')
        # 감정 모델이 없어도 3단이 돌면 FULL이다. sources_used가 실제 목록을 남긴다.
        self.assertEqual(pipeline_mode(None, llm), 'FULL')

    def test_audio_llm_follows_the_server_setting(self):
        # 3단 실행 여부는 서버가 정한다. 워커 환경변수로 되돌리면 운영자가 Lab에서
        # 끄지 못하게 된다.
        import tempfile, wave, os
        from pathlib import Path
        import remote_analyze
        raw = summarize(np.zeros((1, 519)), 20)
        raw['essentia_version'] = 'test'
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
                     patch.object(remote_analyze, 'analyze_audio', return_value=(features, 'test')), \
                     patch.object(remote_analyze, 'predict', return_value=raw), \
                     patch.object(remote_analyze, 'describe',
                                  side_effect=lambda *a, **k: calls.append(a) or {
                                      'model_id': 'm', 'description': 'x'}):
                    job = {'platform': 'youtube', 'track_key': 'abcdefghijk',
                           'artist_name': 'unknown', **job_extra}
                    return remote_analyze.run(audio, job, Path(directory) / 'result.json')

        self.assertIsNotNone(build({'audio_llm_enabled': True})['maest_run']['audio_llm_raw'])
        self.assertEqual(len(calls), 1)

        self.assertIsNone(build({'audio_llm_enabled': False})['maest_run']['audio_llm_raw'])
        self.assertEqual(calls, [], '서버가 껐으면 호출하지 않는다')

        # 키가 없으면 서버가 켜 두어도 건너뛴다. 기동을 막지는 않는다.
        self.assertIsNone(build({'audio_llm_enabled': True}, key='')['maest_run']['audio_llm_raw'])
        self.assertEqual(calls, [])
