import json
import tempfile
import unittest
from pathlib import Path

from manifest import ManifestError, load_job, parse_manifest, resolve_audio_path

VALID = {
    "platform": "youtube",
    "track_key": "abc123",
    "rights_basis": "public_domain",
    "source_reference": "commons: FurElise.ogg (CC0)",
    "audio_filename": "audio.ogg",
}


def manifest_text(**overrides):
    return json.dumps({**VALID, **overrides})


class ParseManifestTest(unittest.TestCase):
    def test_accepts_a_valid_manifest(self):
        parsed = parse_manifest(manifest_text())

        self.assertEqual(parsed["platform"], "youtube")
        self.assertEqual(parsed["audio_filename"], "audio.ogg")

    def test_rejects_broken_json(self):
        with self.assertRaises(ManifestError):
            parse_manifest("{not json")

    def test_rejects_missing_fields(self):
        payload = json.dumps({"platform": "youtube"})
        with self.assertRaisesRegex(ManifestError, "없는 항목"):
            parse_manifest(payload)

    def test_rejects_unknown_platform_and_rights_basis(self):
        with self.assertRaises(ManifestError):
            parse_manifest(manifest_text(platform="bandcamp"))
        with self.assertRaises(ManifestError):
            parse_manifest(manifest_text(rights_basis="probably_fine"))

    def test_rejects_unsupported_extension(self):
        with self.assertRaisesRegex(ManifestError, "확장자"):
            parse_manifest(manifest_text(audio_filename="audio.exe"))

    def test_blocks_path_traversal(self):
        for name in ("../audio.ogg", "/etc/passwd.ogg", "nested/audio.ogg", "..\\audio.ogg", ".."):
            with self.subTest(name=name):
                with self.assertRaises(ManifestError):
                    parse_manifest(manifest_text(audio_filename=name))

    def test_rejects_blank_and_oversized_strings(self):
        with self.assertRaises(ManifestError):
            parse_manifest(manifest_text(track_key="   "))
        with self.assertRaises(ManifestError):
            parse_manifest(manifest_text(source_reference="x" * 501))


class ResolveAudioPathTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.job = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def test_returns_the_file_inside_the_job_directory(self):
        (self.job / "audio.ogg").write_bytes(b"x" * 32)

        self.assertEqual(resolve_audio_path(self.job, "audio.ogg").name, "audio.ogg")

    def test_missing_and_empty_files_are_rejected(self):
        with self.assertRaisesRegex(ManifestError, "없습니다"):
            resolve_audio_path(self.job, "audio.ogg")
        (self.job / "audio.ogg").write_bytes(b"")
        with self.assertRaisesRegex(ManifestError, "비어"):
            resolve_audio_path(self.job, "audio.ogg")

    def test_enforces_the_size_limit(self):
        (self.job / "audio.ogg").write_bytes(b"x" * 128)
        with self.assertRaisesRegex(ManifestError, "너무 큽니다"):
            resolve_audio_path(self.job, "audio.ogg", max_bytes=64)

    def test_symlink_out_of_the_job_directory_is_rejected(self):
        outside = Path(self.tmp.name).parent / "outside-audio.ogg"
        outside.write_bytes(b"x" * 32)
        self.addCleanup(outside.unlink)
        (self.job / "audio.ogg").symlink_to(outside)

        with self.assertRaisesRegex(ManifestError, "벗어납니다"):
            resolve_audio_path(self.job, "audio.ogg")


class LoadJobTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.job = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def test_reads_manifest_and_audio_together(self):
        (self.job / "manifest.json").write_text(manifest_text(), encoding="utf-8")
        (self.job / "audio.ogg").write_bytes(b"x" * 32)

        manifest, audio_path = load_job(self.job)

        self.assertEqual(manifest["track_key"], "abc123")
        self.assertTrue(audio_path.is_file())

    def test_missing_manifest_is_reported(self):
        with self.assertRaisesRegex(ManifestError, "manifest.json"):
            load_job(self.job)


if __name__ == "__main__":
    unittest.main()
