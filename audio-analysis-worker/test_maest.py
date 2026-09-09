import unittest
import numpy as np
from unittest.mock import patch
from maest import summarize, normalize, make_annotation, CLASSES
from emotion import EmotionModelError


class MaestTest(unittest.TestCase):
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
        taxonomy = json.loads((ROOT / 'taxonomy.json').read_text())
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
