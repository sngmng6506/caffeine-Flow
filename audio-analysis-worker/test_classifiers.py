import json
import tempfile
import unittest
from pathlib import Path

from classifiers import (
    ClassifierModelError,
    MusicnnClassifiers,
    average_class_scores,
    head_paths,
    load_classifiers,
    read_head_metadata,
)

# UPF가 배포하는 메타데이터의 실제 모양을 줄인 것.
METADATA = {
    "classes": ["non_sad", "sad"],
    "schema": {
        "inputs": [{"name": "model/Placeholder", "type": "float"}],
        "outputs": [{"name": "model/Softmax", "output_purpose": "predictions"}],
    },
}


def write_metadata(directory, name="mood_sad-msd-musicnn-1.json", data=METADATA):
    path = Path(directory) / name
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


class MetadataTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def test_reads_class_order_from_the_model_file(self):
        """클래스 순서는 헤드마다 다르다. 코드에 적어 두면 조용히 뒤집힌다."""
        metadata = read_head_metadata(write_metadata(self.dir))

        self.assertEqual(metadata["classes"], ["non_sad", "sad"])
        self.assertEqual(metadata["output_node"], "model/Softmax")
        self.assertEqual(metadata["input_node"], "model/Placeholder")

    def test_falls_back_to_essentia_default_nodes(self):
        metadata = read_head_metadata(write_metadata(self.dir, data={"classes": ["a", "b"]}))

        self.assertEqual(metadata["output_node"], "model/Softmax")

    def test_rejects_metadata_without_usable_classes(self):
        for broken in ({}, {"classes": []}, {"classes": ["ok", ""]}, {"classes": "sad"}):
            with self.subTest(broken=broken):
                path = write_metadata(self.dir, data=broken)
                with self.assertRaises(ClassifierModelError):
                    read_head_metadata(path)

    def test_rejects_unreadable_metadata(self):
        path = self.dir / "broken.json"
        path.write_text("{not json", encoding="utf-8")

        with self.assertRaises(ClassifierModelError):
            read_head_metadata(path)


class AverageTest(unittest.TestCase):
    def test_names_each_column_by_class(self):
        scores = average_class_scores([[0.2, 0.8], [0.4, 0.6]], ["non_sad", "sad"])

        self.assertAlmostEqual(scores["non_sad"], 0.3)
        self.assertAlmostEqual(scores["sad"], 0.7)

    def test_drops_broken_frames(self):
        scores = average_class_scores(
            [[0.2, 0.8], [float("nan"), 0.5], [0.1], [0.4, 0.6]], ["non_sad", "sad"]
        )

        self.assertAlmostEqual(scores["sad"], 0.7)

    def test_returns_none_when_nothing_is_usable(self):
        self.assertIsNone(average_class_scores([], ["a", "b"]))
        self.assertIsNone(average_class_scores(None, ["a", "b"]))
        self.assertIsNone(average_class_scores([[float("inf"), 1.0]], ["a", "b"]))

    def test_handles_a_numpy_prediction_matrix(self):
        numpy = __import__("numpy")
        predictions = numpy.array([[0.2, 0.8], [0.4, 0.6]], dtype=numpy.float32)

        scores = average_class_scores(predictions, ["non_sad", "sad"])

        self.assertAlmostEqual(scores["sad"], 0.7, places=5)


class SharedEmbeddingTest(unittest.TestCase):
    def test_computes_embeddings_once_for_every_head(self):
        """임베딩이 가장 비싸다. 헤드마다 다시 계산하면 9배가 된다."""
        calls = []

        def embeddings(audio):
            calls.append(audio)
            return "EMB"

        heads = {
            "mood_sad": (lambda emb: [[0.2, 0.8]], ["non_sad", "sad"]),
            "mood_happy": (lambda emb: [[0.9, 0.1]], ["happy", "non_happy"]),
        }

        scores = MusicnnClassifiers(embeddings, heads).predict([0.1, 0.2])

        self.assertEqual(len(calls), 1)
        self.assertAlmostEqual(scores["mood_sad"]["sad"], 0.8)
        self.assertAlmostEqual(scores["mood_happy"]["happy"], 0.9)

    def test_a_head_returning_nothing_does_not_lose_the_others(self):
        heads = {
            "mood_sad": (lambda emb: None, ["non_sad", "sad"]),
            "mood_happy": (lambda emb: [[0.9, 0.1]], ["happy", "non_happy"]),
        }

        scores = MusicnnClassifiers(lambda audio: "EMB", heads).predict([0.1])

        self.assertNotIn("mood_sad", scores)
        self.assertIn("mood_happy", scores)

    def test_no_heads_means_no_embedding_work(self):
        calls = []
        empty = MusicnnClassifiers(lambda audio: calls.append(audio), {})

        self.assertEqual(empty.predict([0.1]), {})
        self.assertEqual(calls, [])


class LoadTest(unittest.TestCase):
    def test_missing_models_are_not_an_error(self):
        """헤드를 아직 안 받았어도 기본 음향 분석은 계속 돌아야 한다."""
        with tempfile.TemporaryDirectory() as name:
            self.assertIsNone(load_classifiers(name))

    def test_head_file_names_follow_the_essentia_layout(self):
        model, metadata = head_paths("/models", "genre_rosamerica")

        self.assertEqual(model.name, "genre_rosamerica-msd-musicnn-1.pb")
        self.assertEqual(metadata.name, "genre_rosamerica-msd-musicnn-1.json")


if __name__ == "__main__":
    unittest.main()
