import unittest

from suggestions import build_suggestions, mood_tags, rhythmic_character, tempo_class


class SuggestionsTest(unittest.TestCase):
    def test_tempo_boundaries(self):
        self.assertEqual(tempo_class(69.9), "very_slow")
        self.assertEqual(tempo_class(70), "slow")
        self.assertEqual(tempo_class(119.9), "moderate")
        self.assertEqual(tempo_class(145), "very_fast")

    def test_rhythm_uses_danceability(self):
        self.assertEqual(rhythmic_character(0.2), "minimal")
        self.assertEqual(rhythmic_character(0.8), "steady")
        self.assertEqual(rhythmic_character(1.5), "danceable")

    def test_mood_is_not_guessed_without_valence_arousal(self):
        suggestion = build_suggestions({"bpm": 82, "danceability": 0.8})
        self.assertEqual(suggestion["mood_tags"], [])

    def test_valence_arousal_maps_to_review_candidates(self):
        self.assertEqual(mood_tags(0.7, 0.7), ["joyful", "uplifting"])
        self.assertEqual(mood_tags(0.2, 0.8), ["aggressive", "tense"])


if __name__ == "__main__":
    unittest.main()
