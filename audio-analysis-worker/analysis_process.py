"""모델을 재사용하되 시간 초과·추론 오류 때 폐기하는 단일 분석 자식."""
import multiprocessing
import os
import threading
import time


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
