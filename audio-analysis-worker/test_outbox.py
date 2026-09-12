import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from unittest.mock import patch
import outbox
from remote_worker import process
from download import classify_error, error_hint


def remote_worker_cooldown_seconds():
    import remote_worker
    return remote_worker.CONTRACT['retry']['cooldown_seconds']
import subprocess


class OutboxTest(unittest.TestCase):
    def config(self, root):
        return SimpleNamespace(root=Path(root), server_url='https://example.test')

    def test_completed_analysis_survives_outage_and_restart(self):
        with tempfile.TemporaryDirectory() as root:
            config = self.config(root)
            audio_paths = []
            def download(_platform, _key, directory):
                path = directory / 'audio.wav'; path.write_bytes(b'audio'); audio_paths.append(path); return path
            def runner(command, **kwargs):
                Path(command[-1]).write_text(json.dumps({'result': {'saved': True}}))
                return SimpleNamespace(returncode=0)
            job = {'id': 'job', 'lease_token': 'token', 'platform': 'youtube', 'track_key': 'abcdefghijk', 'artist_name': 'artist'}
            with self.assertRaises(OSError):
                process(job, config, downloader=download, runner=runner, call=lambda *a: (_ for _ in ()).throw(OSError('offline')))
            self.assertFalse(audio_paths[0].exists())
            pending = list((config.root / 'outbox').glob('*.json'))
            self.assertEqual(len(pending), 1)
            self.assertTrue(json.loads(pending[0].read_text())['payload']['result']['saved'])
            calls = []
            def connected(c, endpoint, body):
                calls.append(endpoint)
                return {'status': 'processing' if endpoint.endswith('/resume') else 'completed'}
            outbox.drain(config, connected)
            self.assertEqual(calls, ['/jobs/job/resume', '/jobs/job/complete'])
            self.assertFalse(pending[0].exists())

    def test_completed_ack_loss_does_not_submit_again(self):
        with tempfile.TemporaryDirectory() as root:
            config = self.config(root)
            path = outbox.save(config, {'id': 'job'}, '/jobs/job/complete', {'lease_token': 'token'})
            calls = []
            def call(c, endpoint, body):
                calls.append(endpoint); return {'status': 'completed'}
            outbox.deliver(path, config, call)
            self.assertEqual(calls, ['/jobs/job/resume'])
            self.assertFalse(path.exists())

    def test_superseded_result_is_archived_not_lost(self):
        with tempfile.TemporaryDirectory() as root:
            config = self.config(root)
            path = outbox.save(config, {'id': 'job'}, '/jobs/job/complete', {'lease_token': 'old'})
            def replaced(*a): raise HTTPError('', 409, 'stale', {}, None)
            self.assertEqual(outbox.deliver(path, config, replaced)['status'], 'superseded')
            self.assertTrue((path.parent / 'superseded' / path.name).exists())

    def test_permanently_rejected_payload_is_set_aside_not_retried_forever(self):
        # 전송함은 매 반복 맨 앞에서 돈다. 다시 보내도 결과가 같은 항목을 계속 재시도하면
        # 워커 전체가 그 자리에서 멈춘다. 실제로 그렇게 멈춘 적이 있다.
        for code in (400, 404, 422):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as root:
                config = self.config(root)
                path = outbox.save(config, {'id': 'job'}, '/jobs/job/complete', {'lease_token': 'token'})
                def bad(*a, code=code): raise HTTPError('', code, 'schema', {}, None)
                quarantined = outbox.drain(config, bad)
                self.assertEqual([entry['status'] for entry in quarantined], ['rejected'])
                self.assertEqual(quarantined[0]['http_status'], code)
                # 지우지 않는다. 왜 거절됐는지 나중에 봐야 한다.
                self.assertFalse(path.exists())
                self.assertTrue((path.parent / 'rejected' / path.name).exists())
                # 다음 반복은 막히지 않는다.
                self.assertEqual(outbox.drain(config, bad), [])

    def test_temporary_failure_still_stops_the_loop(self):
        # 서버가 잠깐 죽은 것은 재시도로 빠져나올 수 있다. 이건 치우면 안 된다.
        with tempfile.TemporaryDirectory() as root:
            config = self.config(root)
            path = outbox.save(config, {'id': 'job'}, '/jobs/job/complete', {'lease_token': 'token'})
            def down(*a): raise HTTPError('', 503, 'unavailable', {}, None)
            with self.assertRaises(HTTPError): outbox.drain(config, down)
            self.assertTrue(path.exists())

    def test_different_server_cannot_receive_saved_result(self):
        with tempfile.TemporaryDirectory() as root:
            config = self.config(root)
            path = outbox.save(config, {'id': 'job'}, '/jobs/job/complete', {'lease_token': 'token'})
            config.server_url = 'https://other.test'
            with self.assertRaisesRegex(RuntimeError, 'SERVER_MISMATCH'):
                outbox.deliver(path, config, lambda *a: self.fail('must not send'))

    def test_error_hint_picks_the_reason_line(self):
        # DOWNLOAD_FAILED는 분류에 걸리지 않은 것을 모두 받는 통이라, 원문을 남기지
        # 않으면 같은 곡이 반복해 실패해도 이유를 알 방법이 없다. 저널에만 남는다.
        error = subprocess.CalledProcessError(1, [], stderr=(
            b'[youtube] Extracting URL\n'
            b'ERROR: [youtube] abc: Video unavailable\n'
            b'  File "x.py", line 1\n'))
        self.assertEqual(error_hint(error), 'ERROR: [youtube] abc: Video unavailable')
        self.assertEqual(error_hint(subprocess.CalledProcessError(1, [], stderr=b'first\nlast\n')), 'last')
        self.assertEqual(error_hint(FileNotFoundError()), 'FileNotFoundError')
        self.assertEqual(len(error_hint(subprocess.CalledProcessError(
            1, [], stderr=('ERROR: ' + 'x' * 900).encode()))), 300)

    def test_download_error_classes(self):
        self.assertEqual(classify_error(FileNotFoundError()), 'DOWNLOAD_INFRASTRUCTURE')
        self.assertEqual(classify_error(subprocess.CalledProcessError(1, [], stderr=b'HTTP Error 429')), 'DOWNLOAD_INFRASTRUCTURE')
        self.assertEqual(classify_error(subprocess.CalledProcessError(1, [], stderr=b'Private video')), 'SOURCE_UNAVAILABLE')
        self.assertEqual(classify_error(subprocess.TimeoutExpired([], 30)), 'DOWNLOAD_FAILED')

    def test_gone_sources_are_permanent_not_retried(self):
        """다시 받아도 같은 결과인 실패를 재시도 코드로 두면 6시간마다 되돌아와 큐를 막는다."""
        for message in (b'ERROR: [youtube] abc: This video is unavailable',
                        b'ERROR: [youtube] abc: Video unavailable',
                        b'This video is no longer available',
                        b'removed by the uploader',
                        b'account associated with this video has been terminated',
                        b'uploader has not made this video available in your country'):
            with self.subTest(message=message):
                self.assertEqual(
                    classify_error(subprocess.CalledProcessError(1, [], stderr=message)),
                    'SOURCE_UNAVAILABLE')

    def _run_worker(self, error_code, claim_limit=6):
        """워커 루프를 claim_limit번 돌리고 각 claim 시각을 돌려준다."""
        import sys
        import signal
        import remote_worker
        with tempfile.TemporaryDirectory() as root:
            config = self.config(root)
            config.dry_run = False
            config.model_dir = root
            config.poll_interval_ms = 1000
            clock = [0]
            handlers = {}
            claims = []

            def sleep(seconds): clock[0] += seconds

            def call(_config, path, _payload):
                if not path.endswith('/jobs/claim'):
                    return None
                claims.append(clock[0])
                if len(claims) == claim_limit:
                    handlers[signal.SIGTERM](None, None)
                    return None
                return {'id': 'job'}

            fake = SimpleNamespace(TensorflowPredictMAEST=True)
            with patch.object(remote_worker, 'WorkerConfig', return_value=SimpleNamespace(require=lambda: config)), \
                 patch.object(remote_worker, 'verify_tag_model'), \
                 patch.object(remote_worker, 'acquire_lock', return_value=SimpleNamespace(close=lambda: None)), \
                 patch.object(remote_worker.signal, 'signal', side_effect=lambda sig, handler: handlers.update({sig: handler})), \
                 patch.object(remote_worker.time, 'monotonic', side_effect=lambda: clock[0]), \
                 patch.object(remote_worker.time, 'sleep', side_effect=sleep), \
                 patch.object(remote_worker, 'api', side_effect=call), \
                 patch.object(remote_worker, 'process', return_value={'status': 'failed', 'error_code': error_code}), \
                 patch.object(remote_worker, 'log'), \
                 patch.dict(sys.modules, {'essentia': SimpleNamespace(standard=fake), 'essentia.standard': fake}):
                remote_worker.main()
            return claims

    def test_permanent_failures_do_not_pause_the_queue(self):
        """영구 실패는 기다린다고 나아지지 않는다. 연속 실패로 세면 그런 곡 몇 개가
        워커를 내내 휴지 상태로 만들어 멀쩡한 곡이 밀린다."""
        claims = self._run_worker('SOURCE_UNAVAILABLE')

        cooldown = remote_worker_cooldown_seconds()
        gaps = [b - a for a, b in zip(claims, claims[1:])]
        self.assertTrue(gaps, '루프가 여러 번 돌아야 간격을 잴 수 있다')
        self.assertTrue(all(gap < cooldown for gap in gaps), f'휴지 없이 이어져야 한다: {gaps}')

    def test_repeated_temporary_failures_still_pause(self):
        """다시 해 보면 될 수도 있는 실패는 몰아치면 쉬어야 한다."""
        claims = self._run_worker('DOWNLOAD_FAILED')

        cooldown = remote_worker_cooldown_seconds()
        gaps = [b - a for a, b in zip(claims, claims[1:])]
        self.assertTrue(any(gap >= cooldown for gap in gaps), f'3연속 실패 뒤에는 쉬어야 한다: {gaps}')

    def test_worker_pauses_claims_during_shared_failure(self):
        import sys
        import signal
        import remote_worker
        with tempfile.TemporaryDirectory() as root:
            config = self.config(root)
            config.dry_run = False
            config.model_dir = root
            config.poll_interval_ms = 1000
            clock = [0]
            handlers = {}
            claims = []
            def sleep(seconds): clock[0] += seconds
            def call(_config, path, _payload):
                # 수집 요청 조회는 이 시험의 대상이 아니다. job claim만 센다.
                if not path.endswith('/jobs/claim'):
                    return None
                claims.append(clock[0])
                if len(claims) == 2:
                    handlers[signal.SIGTERM](None, None)
                    return None
                return {'id': 'job'}
            fake = SimpleNamespace(TensorflowPredictMAEST=True)
            with patch.object(remote_worker, 'WorkerConfig', return_value=SimpleNamespace(require=lambda: config)), \
                 patch.object(remote_worker, 'verify_tag_model'), \
                 patch.object(remote_worker, 'acquire_lock', return_value=SimpleNamespace(close=lambda: None)), \
                 patch.object(remote_worker.signal, 'signal', side_effect=lambda sig, handler: handlers.update({sig: handler})), \
                 patch.object(remote_worker.time, 'monotonic', side_effect=lambda: clock[0]), \
                 patch.object(remote_worker.time, 'sleep', side_effect=sleep), \
                 patch.object(remote_worker, 'api', side_effect=call), \
                 patch.object(remote_worker, 'process', return_value={'status': 'queued', 'error_code': 'DOWNLOAD_INFRASTRUCTURE'}), \
                 patch.object(remote_worker, 'log'), \
                 patch.dict(sys.modules, {'essentia': SimpleNamespace(standard=fake), 'essentia.standard': fake}):
                remote_worker.main()
            self.assertEqual(len(claims), 2)
            self.assertGreaterEqual(claims[1] - claims[0], remote_worker.CONTRACT['retry']['cooldown_seconds'])
