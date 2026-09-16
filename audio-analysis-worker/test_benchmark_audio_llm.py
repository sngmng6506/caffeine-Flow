import argparse
import unittest

from benchmark_audio_llm import parse_strategies, percentile, rotated, run_strategy, summarize


class ParseStrategiesTest(unittest.TestCase):
    def test_parses_and_deduplicates(self):
        self.assertEqual(parse_strategies('4x30, 3x15,4x30'), ((4, 30), (3, 15)))

    def test_rejects_invalid_values(self):
        for raw in ('', '4', '0x30', '9x10', '3x0', 'axb'):
            with self.subTest(raw=raw), self.assertRaises(argparse.ArgumentTypeError):
                parse_strategies(raw)


class SummaryTest(unittest.TestCase):
    def test_nearest_rank_percentile(self):
        self.assertEqual(percentile([10, 20, 30], 50), 20)
        self.assertEqual(percentile([10, 20, 30], 90), 30)
        self.assertIsNone(percentile([], 90))

    def test_summarizes_successes_without_hiding_failures(self):
        rows = [
            {'strategy': '3x10', 'status': 'completed', 'estimated_end_to_end_sec': 12,
             'llm_request_sec': 9},
            {'strategy': '3x10', 'status': 'completed', 'estimated_end_to_end_sec': 20,
             'llm_request_sec': 17},
            {'strategy': '3x10', 'status': 'failed', 'estimated_end_to_end_sec': 30},
        ]
        result = summarize(rows)[0]
        self.assertEqual(result['runs'], 3)
        self.assertEqual(result['successes'], 2)
        self.assertEqual(result['p50_end_to_end_sec'], 12)
        self.assertEqual(result['p90_end_to_end_sec'], 20)

    def test_rotates_order_between_repeats(self):
        values = ((4, 30), (3, 15), (3, 10))
        self.assertEqual(rotated(values, 1), ((3, 15), (3, 10), (4, 30)))


class RunStrategyTest(unittest.TestCase):
    def test_captures_stage_and_total_times(self):
        seen = {}

        def describe(_audio, _duration, _sha, config, report):
            seen.update(config)
            report({'stage': 'audio_llm_clip_extract', 'status': 'completed', 'elapsed_seconds': 0.1})
            report({'stage': 'audio_llm_payload', 'status': 'completed', 'audio_bytes': 123})
            report({'stage': 'audio_llm_request', 'status': 'completed', 'elapsed_seconds': 1.2})
            return {'description': '설명', 'mood': [], 'instruments': [], 'vocal': [], 'structure': []}

        row = run_strategy('a.wav', 180, 'a' * 64, (3, 10), 1, 2.5,
                           {'model': 'm'}, describe_fn=describe)
        self.assertEqual((seen['segments'], seen['clip_sec']), (3, 10))
        self.assertEqual(row['status'], 'completed')
        self.assertEqual(row['clip_extract_sec'], 0.1)
        self.assertEqual(row['llm_request_sec'], 1.2)
        self.assertEqual(row['audio_bytes'], 123)
        self.assertGreaterEqual(row['estimated_end_to_end_sec'], 2.5)

    def test_records_only_error_type(self):
        def broken(*_args, **_kwargs):
            raise RuntimeError('secret response body')

        row = run_strategy('a.wav', 180, 'a' * 64, (3, 10), 1, 0,
                           {'model': 'm'}, describe_fn=broken)
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['error_type'], 'RuntimeError')
        self.assertNotIn('secret response body', str(row))


if __name__ == '__main__':
    unittest.main()
