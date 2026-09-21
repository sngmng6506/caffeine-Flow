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
    def test_persistent_analysis_submits_without_local_metrics(self):
        paths, calls = [], []
        def download(_platform, _key, directory):
            audio = directory / 'audio.wav'
            audio.write_bytes(b'audio')
            paths.append(audio)
            return audio
        def analyze(audio, job, output):
            self.assertNotIn('lease_token', job)
            output.write_text(json.dumps({'result': {}, 'analysis_run': {}}))
        result = process({'id': 'job', 'platform': 'youtube', 'track_key': 'abcdefghijk',
                          'artist_name': 'artist', 'lease_token': 'lease'}, None,
                         downloader=download, analyzer=SimpleNamespace(analyze=analyze),
                         call=lambda _, path, body: calls.append((path, body)) or {'status': 'completed'})
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(set(calls[0][1]), {'result', 'analysis_run', 'lease_token'})
        self.assertFalse(paths[0].exists())

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
            Path(command[-1]).write_text(json.dumps({'result': {}, 'automatic_annotation': {'mood_tags': ['calm'], 'genre_tags': []}}))
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
        # runner를 주입한다. download.subprocess.run을 patch해도 기본 인자는 def
        # 시점에 묶여 있어 download_audio가 실제 yt-dlp를 부른다 — 테스트가 망을
        # 타면 느리고, 바깥 세상이 바뀌면 코드와 무관하게 깨진다.
        import tempfile

        def timing_out(*args, **kwargs):
            raise subprocess.TimeoutExpired('private-url', 300)

        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(DownloadError, '^DOWNLOAD_FAILED$'):
                download_audio('youtube', 'abcdefghijk', directory, runner=timing_out)


if __name__ == '__main__': unittest.main()


class DurationGateTest(unittest.TestCase):
    """길이 한도를 벗어난 곡은 받기 전에 영구 실패로 보낸다.

    받아 본 뒤 DOWNLOAD_FAILED로 처리하면 서버가 일시 장애로 보고 6시간마다
    영원히 다시 시도한다(temporary_codes). 실측: 148분짜리 "케이팝 노동요"
    플레이리스트가 큐에 있었다.

    게이트는 yt-dlp의 --match-filter 하나다. 예전에는 --skip-download 호출로
    길이를 미리 재는 단계가 앞에 하나 더 있었지만, 추출을 두 번 하느라 2.5초를
    더 쓰면서 걸러내는 곡은 같았다.
    """

    def filtered_run(self, directory, seen=None):
        # yt-dlp는 --match-filter로 거른 곡을 오류 없이 넘긴다 — exit 0에 파일 없음.
        def runner(command, **_kwargs):
            if seen is not None:
                seen.append(command)
            return SimpleNamespace(stdout=b'', stderr=b'')
        return download_audio('youtube', 'abcdefghijk', directory, runner=runner)

    def test_filtered_source_is_permanently_rejected(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            # DOWNLOAD_FAILED로 떨어지면 6시간마다 영원히 재시도한다.
            with self.assertRaisesRegex(DownloadError, '^SOURCE_UNSUPPORTED$'):
                self.filtered_run(directory)

    def test_match_filter_carries_the_contract_limits(self):
        # 게이트가 yt-dlp 인자 안으로 들어갔으므로 한도가 실제로 실리는지 본다.
        import tempfile
        import download
        seen = []
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(DownloadError):
                self.filtered_run(directory, seen)
        command = seen[0]
        matched = command[command.index('--match-filter') + 1]
        self.assertIn(f'duration >= {download.MIN_DURATION}', matched)
        self.assertIn(f'duration <= {download.MAX_DURATION}', matched)
        self.assertIn('!is_live', matched)

    def test_limit_comes_from_the_shared_contract(self):
        import json
        from pathlib import Path
        import download
        contract = json.loads((Path(download.__file__).resolve().parents[1]
                               / 'server/src/constants/audio-pipeline.json').read_text())
        self.assertEqual(download.MAX_DURATION, contract['audio_duration_sec']['max'])
        self.assertEqual(download.MIN_DURATION, contract['audio_duration_sec']['min'])


class DiscoveryLoopTest(unittest.TestCase):
    """수집은 분석 큐가 빈 뒤에만 돈다. 신청곡 처리가 항상 먼저다."""

    def test_skipped_while_analysis_jobs_remain(self):
        import remote_worker
        calls = []

        def api(_config, endpoint, _body):
            calls.append(endpoint)
            return {'id': 'job', 'platform': 'youtube', 'track_key': 'abcdefghijk',
                    'artist_name': 'a', 'lease_token': 'lease'} if endpoint.endswith('/jobs/claim') else None

        with patch.object(remote_worker, 'api', side_effect=api):
            claimed = remote_worker.api(None, '/jobs/claim', {})
        self.assertIsNotNone(claimed)
        self.assertNotIn('/discoveries/claim', calls)

    def test_collects_and_reports_when_queue_is_empty(self):
        import remote_worker
        posted = {}

        def api(_config, endpoint, body):
            if endpoint.endswith('/discoveries/claim'):
                return {'id': 'd1', 'source': 'apple_global', 'query': None,
                        'requested_limit': 5, 'lease_token': 'lease'}
            posted[endpoint] = body
            return {'status': 'done'}

        with patch.object(remote_worker, 'api', side_effect=api):
            handled = remote_worker.run_discovery(None, collector=lambda *a: (
                [{'platform': 'youtube', 'track_key': 'abcdefghijk', 'title': 'x', 'artist_name': 'y'}], 5))

        self.assertTrue(handled)
        self.assertIn('/discoveries/d1/complete', posted)
        self.assertEqual(posted['/discoveries/d1/complete']['tracks'][0]['track_key'], 'abcdefghijk')
        self.assertEqual(posted['/discoveries/d1/complete']['scanned'], 5, '훑은 개수를 함께 보고한다')

    def test_collection_failure_is_reported_not_raised(self):
        import remote_worker
        from discover import DiscoveryError
        posted = {}

        def api(_config, endpoint, body):
            if endpoint.endswith('/discoveries/claim'):
                return {'id': 'd1', 'source': 'apple_global', 'query': None,
                        'requested_limit': 5, 'lease_token': 'lease'}
            posted[endpoint] = body
            return {}

        def broken(*_a):
            raise DiscoveryError('SOURCE_FETCH_FAILED')

        with patch.object(remote_worker, 'api', side_effect=api):
            self.assertTrue(remote_worker.run_discovery(None, collector=broken))

        self.assertEqual(posted['/discoveries/d1/fail']['error_code'], 'SOURCE_FETCH_FAILED')
