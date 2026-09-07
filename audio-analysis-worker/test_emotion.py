import math
import unittest

from emotion import (
    RAW_MAX,
    RAW_MIN,
    estimate_valence_arousal,
    normalize_score,
    summarize_predictions,
)


class NormalizeTest(unittest.TestCase):
    def test_maps_deam_scale_to_unit_range(self):
        self.assertAlmostEqual(normalize_score(RAW_MIN), 0.0)
        self.assertAlmostEqual(normalize_score(RAW_MAX), 1.0)
        self.assertAlmostEqual(normalize_score(5.0), 0.5)


class SummarizeTest(unittest.TestCase):
    def test_averages_frames_before_normalizing(self):
        summary = summarize_predictions([[3.0, 5.0], [5.0, 7.0]])

        self.assertAlmostEqual(summary["valence"], 0.375)
        self.assertAlmostEqual(summary["arousal"], 0.625)
        self.assertEqual(summary["frames"], 2)

    def test_empty_result_is_not_guessed(self):
        self.assertIsNone(summarize_predictions([]))
        self.assertIsNone(summarize_predictions(None))

    def test_drops_non_finite_frames(self):
        summary = summarize_predictions([[5.0, 5.0], [float("nan"), 5.0], [math.inf, 1.0]])

        self.assertEqual(summary["frames"], 1)
        self.assertAlmostEqual(summary["valence"], 0.5)

    def test_drops_frames_far_outside_the_training_range(self):
        # 회귀 모델이 학습 범위를 크게 벗어나면 입력을 이해하지 못한 것으로 본다.
        summary = summarize_predictions([[5.0, 5.0], [42.0, -13.0]])

        self.assertEqual(summary["frames"], 1)

    def test_all_frames_invalid_returns_none(self):
        self.assertIsNone(summarize_predictions([[float("nan"), 1.0], [99.0, 99.0]]))

    def test_ignores_frames_with_wrong_arity(self):
        self.assertIsNone(summarize_predictions([[5.0], [5.0, 5.0, 5.0]]))

    def test_clamps_mild_overshoot_into_server_range(self):
        # 서버는 0~1만 받는다. 학습 범위를 살짝 넘긴 예측 때문에 400을 맞지 않아야 한다.
        summary = summarize_predictions([[0.2, 9.8]])

        self.assertEqual(summary["valence"], 0.0)
        self.assertEqual(summary["arousal"], 1.0)


class NumpyInputTest(unittest.TestCase):
    """실제 예측기는 numpy 2차원 배열을 준다. 파이썬 리스트로만 검증하면 놓친다."""

    def test_handles_a_numpy_prediction_matrix(self):
        numpy = __import__("numpy")
        predictions = numpy.array([[3.0, 5.0], [5.0, 7.0]], dtype=numpy.float32)

        summary = summarize_predictions(predictions)

        self.assertAlmostEqual(summary["valence"], 0.375, places=5)
        self.assertEqual(summary["frames"], 2)

    def test_empty_numpy_result_is_not_guessed(self):
        numpy = __import__("numpy")

        self.assertIsNone(summarize_predictions(numpy.empty((0, 2), dtype=numpy.float32)))


class EstimateTest(unittest.TestCase):
    def test_disabled_predictor_returns_none(self):
        self.assertIsNone(estimate_valence_arousal([0.0], None))

    def test_uses_the_injected_predictor(self):
        calls = []

        def predictor(audio):
            calls.append(audio)
            return [[5.0, 5.0]]

        summary = estimate_valence_arousal([0.1, 0.2], predictor)

        self.assertEqual(calls, [[0.1, 0.2]])
        self.assertAlmostEqual(summary["valence"], 0.5)


if __name__ == "__main__":
    unittest.main()
