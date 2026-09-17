"""실제 자식 프로세스로 재사용·시간 초과·죽은 연결을 확인한다. 모델·망 불필요."""
import contextlib
import io
import os
import time
import unittest
import wave
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch, Mock
from analysis_process import AnalysisProcess
from timing import measure


def fake_child(connection):
    connection.send(('ready', None))
    while True:
        audio, job, output = connection.recv()
        if job.get('crash'):
            return
        if job.get('hang'):
            time.sleep(10)
        connection.send(('timing', {'pid': os.getpid()}))
        connection.send(('done', None))


class AnalysisProcessTest(unittest.TestCase):
    def test_server_initializes_models_once_for_two_jobs(self):
        from analysis_process import serve
        import remote_analyze
        connection = Mock()
        connection.recv.side_effect = [('a', {}, 'out'), ('b', {}, 'out'), None]
        models = (object(), object())
        with patch.dict(os.environ, {}, clear=False), \
             patch.object(remote_analyze, 'initialize_models', return_value=models) as initialize, \
             patch.object(remote_analyze, 'run') as run:
            serve(connection)
        initialize.assert_called_once()
        self.assertEqual(run.call_count, 2)
        self.assertTrue(all(call.kwargs['models'] is models for call in run.call_args_list))

    def test_reuses_child_and_restarts_after_timeout(self):
        events = []
        worker = AnalysisProcess(events.append, timeout=5, target=fake_child)
        try:
            worker.analyze('audio', {}, 'output')
            worker.analyze('audio', {}, 'output')
            self.assertEqual(events[0]['pid'], events[1]['pid'])
            worker.timeout = 0.1
            with self.assertRaises(RuntimeError):
                worker.analyze('audio', {'hang': True}, 'output')
            self.assertIsNone(worker.process)
            worker.timeout = 5
            worker.analyze('audio', {}, 'output')
            self.assertNotEqual(events[0]['pid'], events[-1]['pid'])
        finally:
            worker.close()

    def test_child_crash_is_recoverable(self):
        worker = AnalysisProcess(lambda event: None, timeout=5, target=fake_child)
        try:
            with self.assertRaises((EOFError, OSError)):
                worker.analyze('audio', {'crash': True}, 'output')
            self.assertIsNone(worker.process)
            worker.analyze('audio', {}, 'output')
        finally:
            worker.close()

    def test_failed_stage_is_reported(self):
        events = []
        with self.assertRaises(ValueError):
            with measure(events.append, 'maest'):
                raise ValueError('private detail')
        self.assertEqual(events[0]['status'], 'failed')
        self.assertNotIn('private detail', str(events))

    def test_model_failure_leaves_the_reason_in_the_journal(self):
        # 파이프로는 분류 코드만 간다. 원인을 어디에도 남기지 않으면 모델이 없는
        # 것인지 해시가 다른 것인지 미니PC에 접속해 재현하는 수밖에 없다.
        from analysis_process import serve
        import remote_analyze
        connection = Mock()
        journal = io.StringIO()
        with patch.object(remote_analyze, 'initialize_models',
                          side_effect=RuntimeError('모델 해시가 다릅니다')), \
             contextlib.redirect_stderr(journal):
            serve(connection)
        connection.send.assert_any_call(('error', 'MODEL_UNAVAILABLE'))
        self.assertIn('모델 해시가 다릅니다', journal.getvalue())

    def test_inference_failure_leaves_the_reason_in_the_journal(self):
        from analysis_process import serve
        import remote_analyze
        connection = Mock()
        connection.recv.side_effect = [('a', {}, 'out')]
        journal = io.StringIO()
        with patch.object(remote_analyze, 'initialize_models', return_value=(object(), object())), \
             patch.object(remote_analyze, 'run', side_effect=RuntimeError('MAEST 출력 차원')), \
             contextlib.redirect_stderr(journal):
            serve(connection)
        connection.send.assert_any_call(('error', 'ANALYSIS_FAILED'))
        self.assertIn('MAEST 출력 차원', journal.getvalue())
