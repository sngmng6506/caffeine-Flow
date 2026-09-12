"""모델을 재사용하되 시간 초과·추론 오류 때 폐기하는 단일 분석 자식."""
import multiprocessing
import os
import sys
import threading
import time
import traceback


def journal_reason():
    """실패한 원인을 부모 저널에만 남긴다.

    파이프로는 분류 코드만 나간다. 코드만 보면 모델 파일이 없는 것인지, 해시가
    다른 것인지, essentia-tensorflow가 깔리지 않은 것인지 구분할 수 없어 미니PC에
    접속해 손으로 재현하는 수밖에 없다. 자식은 부모의 stderr를 그대로 쓰므로
    여기 찍은 것은 journald에 남고 서버·Discord로는 나가지 않는다.
    """
    traceback.print_exc()
    sys.stderr.flush()


def serve(connection):
    for key in ('AUDIO_ANALYSIS_WORKER_TOKEN', 'DISCORD_AUDIO_WEBHOOK_URL'):
        os.environ.pop(key, None)
    from timing import measure
    lock = threading.Lock()

    def report(value):
        with lock:
            connection.send(('timing', value))

    try:
        with measure(report, 'model_initialization'):
            from remote_analyze import initialize_models, run
            models = initialize_models()
        connection.send(('ready', None))
    except Exception:
        journal_reason()
        connection.send(('error', 'MODEL_UNAVAILABLE'))
        return
    while True:
        try:
            request = connection.recv()
        except EOFError:
            return
        if request is None:
            return
        try:
            cpu_started = time.process_time()
            run(*request, models=models, report=report)
            resources = {'stage': 'analysis_resources', 'cpu_seconds': round(time.process_time() - cpu_started, 4)}
            if os.name == 'posix':
                import resource
                resources['process_peak_rss_kib'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            report(resources)
            connection.send(('done', None))
        except Exception as error:
            journal_reason()
            from emotion import EmotionModelError
            connection.send(('error', 'MODEL_UNAVAILABLE' if isinstance(error, EmotionModelError) else 'ANALYSIS_FAILED'))
            return


class AnalysisProcess:
    def __init__(self, report, timeout=600, target=serve):
        self.report, self.timeout, self.target = report, timeout, target
        self.process = self.connection = None

    def receive(self, expected):
        deadline = time.monotonic() + self.timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not self.connection.poll(remaining):
                raise RuntimeError('ANALYSIS_FAILED')
            kind, value = self.connection.recv()
            if kind == 'timing':
                self.report(value)
            elif kind == expected:
                return
            else:
                raise RuntimeError(value if kind == 'error' else 'ANALYSIS_FAILED')

    def start(self):
        if self.process is not None and self.process.is_alive():
            return
        self.close()
        context = multiprocessing.get_context('spawn')
        self.connection, child = context.Pipe()
        self.process = context.Process(target=self.target, args=(child,))
        self.process.start()
        child.close()
        try:
            self.receive('ready')
        except Exception:
            self.close()
            raise

    def analyze(self, audio, job, output):
        try:
            self.start()
            self.connection.send((str(audio), job, str(output)))
            self.receive('done')
        except Exception:
            self.close()
            raise

    def close(self):
        if self.process is not None:
            if self.process.is_alive():
                self.process.terminate()
            self.process.join(timeout=5)
            if self.process.is_alive():
                self.process.kill()
                self.process.join()
            self.process.close()
        if self.connection is not None:
            self.connection.close()
        self.process = self.connection = None
