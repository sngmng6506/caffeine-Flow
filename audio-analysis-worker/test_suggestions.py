import unittest

from suggestions import (
    build_suggestions,
    mood_tags_from_valence_arousal,
    rhythmic_character,
    tempo_class,
)

# 실제 헤드 출력 모양의 최소 표본. 클래스 이름은 모델 .json에서 온다.
CONFIDENT_SCORES = {
    "voice_instrumental": {"instrumental": 0.05, "voice": 0.95},
    "mood_acoustic": {"acoustic": 0.88, "non_acoustic": 0.12},
    "mood_electronic": {"electronic": 0.10, "non_electronic": 0.90},
    "mood_relaxed": {"relaxed": 0.91, "non_relaxed": 0.09},
    "genre_rosamerica": {
        "cla": 0.02, "dan": 0.03, "hip": 0.01, "jaz": 0.86,
        "pop": 0.04, "rhy": 0.02, "roc": 0.01, "spe": 0.01,
    },
}


class HeuristicFieldsTest(unittest.TestCase):
    def test_tempo_boundaries(self):
        self.assertEqual(tempo_class(69.9), "very_slow")
        self.assertEqual(tempo_class(70), "slow")
        self.assertEqual(tempo_class(119.9), "moderate")
        self.assertEqual(tempo_class(145), "very_fast")

    def test_rhythm_uses_danceability(self):
        self.assertEqual(rhythmic_character(0.2), "minimal")
        self.assertEqual(rhythmic_character(0.8), "steady")
        self.assertEqual(rhythmic_character(1.5), "danceable")

    def test_heuristic_fields_carry_no_confidence(self):
        """BPM 구간에는 확률이 없다. 없는 신뢰도를 지어내면 정렬이 거짓말을 한다."""
        suggestion = build_suggestions({"bpm": 96, "danceability": 0.8})

        self.assertEqual(suggestion["tempo_class"], "moderate")
        self.assertNotIn("tempo_class", suggestion.get("confidence", {}))


class ClassifierFieldsTest(unittest.TestCase):
    def test_fills_every_label_field_from_heads(self):
        suggestion = build_suggestions({"bpm": 96, "danceability": 0.8}, CONFIDENT_SCORES)

        self.assertEqual(suggestion["vocal_type"], "singing")
        self.assertEqual(suggestion["instrumentation_type"], "acoustic")
        self.assertEqual(suggestion["genre_tags"], ["jazz"])
        self.assertEqual(suggestion["mood_tags"], ["peaceful"])
        self.assertAlmostEqual(suggestion["confidence"]["genre_tags"], 0.86)

    def test_min_confidence_is_the_weakest_field(self):
        suggestion = build_suggestions({"bpm": 96}, CONFIDENT_SCORES)

        self.assertAlmostEqual(suggestion["min_confidence"], 0.86)

    def test_weak_fields_are_flagged_for_listening(self):
        weak = {**CONFIDENT_SCORES, "voice_instrumental": {"instrumental": 0.34, "voice": 0.66}}

        suggestion = build_suggestions({"bpm": 96}, weak)

        self.assertIn("low_confidence:vocal_type", suggestion["review_flags"])

    def test_unfilled_fields_are_flagged_as_missing(self):
        suggestion = build_suggestions({"bpm": 96}, {})

        self.assertIn("missing:vocal_type", suggestion["review_flags"])
        self.assertIn("missing:genre_tags", suggestion["review_flags"])

    def test_contradiction_between_heads_is_flagged(self):
        conflicting = {
            **CONFIDENT_SCORES,
            "voice_instrumental": {"instrumental": 0.92, "voice": 0.08},
            "genre_rosamerica": {**CONFIDENT_SCORES["genre_rosamerica"], "hip": 0.91},
        }

        suggestion = build_suggestions({"bpm": 96}, conflicting)

        self.assertEqual(suggestion["vocal_type"], "none")
        self.assertIn("hiphop_rap", suggestion["genre_tags"])
        self.assertIn("conflict:vocal_genre", suggestion["review_flags"])


class MoodFallbackTest(unittest.TestCase):
    def test_mood_is_not_guessed_without_heads_or_valence_arousal(self):
        suggestion = build_suggestions({"bpm": 82, "danceability": 0.8})

        self.assertEqual(suggestion["mood_tags"], [])

    def test_valence_arousal_fills_mood_only_when_heads_are_absent(self):
        self.assertEqual(mood_tags_from_valence_arousal(0.7, 0.7), ["joyful", "uplifting"])
        self.assertEqual(mood_tags_from_valence_arousal(0.2, 0.8), ["aggressive", "tense"])

        fallback = build_suggestions({"bpm": 96, "valence": 0.7, "arousal": 0.7})
        self.assertEqual(fallback["mood_tags"], ["joyful", "uplifting"])
        # 회귀값을 사분면으로 나눈 것이라 확률이 아니다.
        self.assertNotIn("mood_tags", fallback.get("confidence", {}))

    def test_heads_win_over_valence_arousal(self):
        suggestion = build_suggestions(
            {"bpm": 96, "valence": 0.7, "arousal": 0.7}, CONFIDENT_SCORES
        )

        self.assertEqual(suggestion["mood_tags"], ["peaceful"])


if __name__ == "__main__":
    unittest.main()
