"""실패한 단계도 부모 저널에 전달하는 로컬 계측."""
import time
from contextlib import contextmanager


@contextmanager
def measure(report, stage):
    started = time.monotonic()
    status = 'failed'
    try:
        yield
        status = 'completed'
    finally:
        if report is not None:
            report({'stage': stage, 'status': status,
                    'elapsed_seconds': round(time.monotonic() - started, 4)})
