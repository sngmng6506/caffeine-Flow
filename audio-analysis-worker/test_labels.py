import unittest

from labels import (
    contradiction_flags,
    genre_tags,
    instrumentation_type,
    mood_tags,
    probability,
    vocal_type,
)


class ProbabilityGuardTest(unittest.TestCase):
    def test_rejects_values_that_are_not_probabilities(self):
        for bad in ({"a": "0.9"}, {"a": None}, {"a": True}, {"a": 1.4}, {"a": -0.1}):
            with self.subTest(bad=bad):
                self.assertIsNone(probability(bad, "a"))
        self.assertIsNone(probability(None, "a"))
        self.assertIsNone(probability({}, "missing"))

    def test_accepts_a_valid_probability(self):
        self.assertAlmostEqual(probability({"a": 0.25}, "a"), 0.25)


class InstrumentationTest(unittest.TestCase):
    def test_both_high_means_mixed_instrumentation(self):
        value, score = instrumentation_type({"acoustic": 0.9}, {"electronic": 0.7})

        self.assertEqual(value, "hybrid")
        # 덜 확신한 쪽이 이 판단의 신뢰도다.
        self.assertAlmostEqual(score, 0.7)

    def test_both_low_is_left_empty(self):
        """어느 쪽도 아니라고 본 것이다. 값을 지어내면 눈으로 넘길 때 통과한다."""
        value, score = instrumentation_type({"acoustic": 0.3}, {"electronic": 0.2})

        self.assertIsNone(value)
        self.assertAlmostEqual(score, 0.3)

    def test_one_side_wins_cleanly(self):
        self.assertEqual(instrumentation_type({"acoustic": 0.2}, {"electronic": 0.95})[0], "electronic")

    def test_missing_head_returns_nothing(self):
        self.assertEqual(instrumentation_type(None, {"electronic": 0.95}), (None, None))


class VocalTest(unittest.TestCase):
    def test_instrumental_wins_without_consulting_genre(self):
        value, score = vocal_type({"instrumental": 0.8, "voice": 0.2}, {"hip": 0.99})

        self.assertEqual(value, "none")
        self.assertAlmostEqual(score, 0.8)

    def test_rap_needs_both_voice_and_a_speech_like_genre(self):
        self.assertEqual(vocal_type({"instrumental": 0.1, "voice": 0.9}, {"hip": 0.8})[0], "rap_spoken")
        self.assertEqual(vocal_type({"instrumental": 0.1, "voice": 0.9}, {"spe": 0.7})[0], "rap_spoken")
        self.assertEqual(vocal_type({"instrumental": 0.1, "voice": 0.9}, {"hip": 0.2})[0], "singing")

    def test_missing_genre_head_still_gives_singing(self):
        self.assertEqual(vocal_type({"instrumental": 0.1, "voice": 0.9})[0], "singing")


class GenreTest(unittest.TestCase):
    def test_takes_the_top_two_above_the_threshold(self):
        codes, score = genre_tags({"jaz": 0.9, "pop": 0.7, "roc": 0.65, "cla": 0.1})

        self.assertEqual(codes, ["jazz", "pop"])
        self.assertAlmostEqual(score, 0.9)

    def test_everything_below_the_threshold_is_left_empty(self):
        self.assertEqual(genre_tags({"jaz": 0.4, "pop": 0.3}), ([], None))


class MoodTest(unittest.TestCase):
    def test_takes_the_two_strongest_confident_moods(self):
        codes, score = mood_tags({
            "mood_happy": {"happy": 0.9},
            "mood_party": {"party": 0.8},
            "mood_sad": {"sad": 0.7},
        })

        self.assertEqual(codes, ["joyful", "uplifting"])
        self.assertAlmostEqual(score, 0.9)

    def test_uncertain_heads_are_skipped(self):
        self.assertEqual(mood_tags({"mood_happy": {"happy": 0.4}}), ([], None))


class ContradictionTest(unittest.TestCase):
    def test_opposite_moods_together_need_a_listen(self):
        flags = contradiction_flags({"mood_tags": ["aggressive", "peaceful"]})

        self.assertIn("conflict:mood", flags)

    def test_instrumental_rap_is_impossible(self):
        flags = contradiction_flags({"vocal_type": "none", "genre_tags": ["hiphop_rap"]})

        self.assertIn("conflict:vocal_genre", flags)

    def test_a_coherent_annotation_has_no_flags(self):
        flags = contradiction_flags({
            "mood_tags": ["peaceful", "tender"],
            "vocal_type": "singing",
            "genre_tags": ["jazz"],
        })

        self.assertEqual(flags, [])


if __name__ == "__main__":
    unittest.main()
