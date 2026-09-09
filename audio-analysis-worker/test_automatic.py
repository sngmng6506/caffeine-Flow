import json
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from download import source_url, download_audio, DownloadError
from remote_worker import process
from unittest.mock import patch
from emotion import estimate_valence_arousal


class AutomaticTest(unittest.TestCase):
    def test_platform_urls_only(self):
        self.assertIn('youtube.com', source_url('youtube', 'abcdefghijk'))
        self.assertEqual(source_url('soundcloud', 'https://soundcloud.com/artist/track?x=1'), 'https://soundcloud.com/artist/track')
        for platform, key in [('youtube', 'https://localhost/'), ('spotify', 'anything'),
                              ('soundcloud', 'https://soundcloud.com.evil.test/a/b'),
                              ('soundcloud', 'https://user@soundcloud.com/a/b'),
                              ('soundcloud', 'http://soundcloud.com/a/b'),
                              ('soundcloud', 'https://soundcloud.com/a/sets'),
                              ('soundcloud', 'https://127.0.0.1/a/b')]:
            with self.assertRaises(DownloadError): source_url(platform, key)

    def test_emotion_failure_does_not_discard_base_features(self):
        with self.assertWarns(RuntimeWarning):
            self.assertIsNone(estimate_valence_arousal([], lambda _: (_ for _ in ()).throw(RuntimeError('failed'))))

    def test_remote_success_cleans_audio_and_submits_full_labels(self):
        paths, calls = [], []
        def download(_platform, _key, directory):
            path = directory / 'audio.ogg'; path.write_bytes(b'audio'); paths.append(path); return path
        def runner(command, **kwargs):
            Path(command[-1]).write_text(json.dumps({'result': {}, 'automatic_annotation': {'genre_tags': ['jazz']}, 'tag_scores': {}}))
            self.assertNotIn('shell', kwargs)
            return SimpleNamespace(returncode=0)
        def api(_config, url, body):
            calls.append((url, body)); return {'id': 'analysis'}
        process({'id': 'job', 'platform': 'youtube', 'track_key': 'abcdefghijk', 'artist_name': 'artist', 'lease_token': 'lease'},
                None, call=api, downloader=download, runner=runner)
        self.assertFalse(paths[0].exists())
        self.assertTrue(calls[0][0].endswith('/complete'))
        self.assertEqual(calls[0][1]['lease_token'], 'lease')

    def test_download_failure_does_not_mark_completed(self):
        calls = []
        def broken(*args): raise DownloadError('DOWNLOAD_FAILED')
        process({'id': 'job', 'platform': 'youtube', 'track_key': 'abcdefghijk', 'lease_token': 'lease'},
                None, call=lambda c, url, body: calls.append((url, body)), downloader=broken)
        self.assertTrue(calls[0][0].endswith('/fail'))

    def test_timeout_is_sanitized(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory, patch('download.subprocess.run', side_effect=subprocess.TimeoutExpired('private-url', 300)):
            with self.assertRaisesRegex(DownloadError, '^DOWNLOAD_FAILED$'):
                download_audio('youtube', 'abcdefghijk', directory)


if __name__ == '__main__': unittest.main()
