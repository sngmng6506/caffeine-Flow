import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from unittest.mock import patch
import outbox
from remote_worker import process
from download import classify_error
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

    def test_rejected_payload_stays_and_blocks_new_work(self):
        with tempfile.TemporaryDirectory() as root:
            config = self.config(root)
            path = outbox.save(config, {'id': 'job'}, '/jobs/job/complete', {'lease_token': 'token'})
            def bad(*a): raise HTTPError('', 400, 'schema', {}, None)
            with self.assertRaises(HTTPError): outbox.drain(config, bad)
            self.assertTrue(path.exists())

    def test_different_server_cannot_receive_saved_result(self):
        with tempfile.TemporaryDirectory() as root:
            config = self.config(root)
            path = outbox.save(config, {'id': 'job'}, '/jobs/job/complete', {'lease_token': 'token'})
            config.server_url = 'https://other.test'
            with self.assertRaisesRegex(RuntimeError, 'SERVER_MISMATCH'):
                outbox.deliver(path, config, lambda *a: self.fail('must not send'))

    def test_download_error_classes(self):
        self.assertEqual(classify_error(FileNotFoundError()), 'DOWNLOAD_INFRASTRUCTURE')
        self.assertEqual(classify_error(subprocess.CalledProcessError(1, [], stderr=b'HTTP Error 429')), 'DOWNLOAD_INFRASTRUCTURE')
        self.assertEqual(classify_error(subprocess.CalledProcessError(1, [], stderr=b'Private video')), 'SOURCE_UNAVAILABLE')
        self.assertEqual(classify_error(subprocess.TimeoutExpired([], 30)), 'DOWNLOAD_FAILED')

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
            def call(_config, _path, _payload):
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
