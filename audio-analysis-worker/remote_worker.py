#!/usr/bin/env python3
"""서버 큐 claim → 다운로드 → 분석 → 자동 라벨 저장. 사람의 파일 등록 불필요."""
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from download import download_audio, DownloadError
from maest import verify_tag_model
from worker import WorkerConfig, ensure_queue_dirs, acquire_lock, log


def api(config, path, body):
    request = Request(config.server_url + '/api/v1/audio-analysis' + path,
                      data=json.dumps(body).encode(), method='POST',
                      headers={'Authorization': f'Bearer {config.token}', 'Content-Type': 'application/json'})
    with urlopen(request, timeout=30) as response:
        return None if response.status == 204 else json.loads(response.read())


def process(job, config, call=api, downloader=download_audio, runner=subprocess.run):
    # 실패·성공 어느 쪽에서도 임시 음원을 삭제한다. 원본을 결과 서버에 보내지 않는다.
    with tempfile.TemporaryDirectory(prefix='cf-audio-') as directory:
        root = Path(directory)
        try:
            audio = downloader(job['platform'], job['track_key'], root)
        except DownloadError as error:
            code = str(error) if str(error) == 'SOURCE_UNSUPPORTED' else 'DOWNLOAD_FAILED'
            return call(config, f"/jobs/{job['id']}/fail", {'lease_token': job['lease_token'], 'error_code': code})
        job_file, output = root / 'job.json', root / 'result.json'
        # 인증 토큰은 모델 프로세스의 작업 파일·명령 인자에 쓰지 않는다.
        job_file.write_text(json.dumps({k: job[k] for k in ('platform', 'track_key', 'artist_name')}))
        try:
            completed = runner([sys.executable, str(Path(__file__).with_name('remote_analyze.py')),
                                str(audio), str(job_file), str(output)],
                               capture_output=True, timeout=600, check=False,
                               env={k: v for k, v in os.environ.items() if k not in ('AUDIO_ANALYSIS_WORKER_TOKEN', 'DISCORD_AUDIO_WEBHOOK_URL')})
            if completed.returncode:
                raise RuntimeError('MODEL_UNAVAILABLE' if completed.returncode == 3 else 'ANALYSIS_FAILED')
            payload = json.loads(output.read_text())
        except (subprocess.SubprocessError, OSError, ValueError, RuntimeError) as error:
            code = 'MODEL_UNAVAILABLE' if str(error) == 'MODEL_UNAVAILABLE' else 'ANALYSIS_FAILED'
            return call(config, f"/jobs/{job['id']}/fail", {'lease_token': job['lease_token'], 'error_code': code})
        payload['lease_token'] = job['lease_token']
        # 응답 유실은 같은 lease로 재전송한다. 서버가 완료 재전송을 멱등 처리한다.
        for attempt in range(3):
            try:
                return call(config, f"/jobs/{job['id']}/complete", payload)
            except HTTPError as error:
                if error.code < 500:
                    raise
            except OSError:
                pass
            if attempt < 2:
                time.sleep(2 ** attempt)
        raise RuntimeError('RESULT_SUBMIT_FAILED')  # lease 만료 뒤 서버가 회수한다.


def main():
    config = WorkerConfig(os.environ).require()
    if config.dry_run:
        raise ValueError('서버 큐에서는 dry-run을 지원하지 않습니다. CLI --dry-run을 사용하세요.')
    # 모델 미설치 상태에서 신청곡마다 재시도 횟수를 소진하지 않는다.
    verify_tag_model(config.model_dir)
    import essentia.standard as standard
    if not hasattr(standard, 'TensorflowPredictMAEST'):
        raise RuntimeError('requirements-tensorflow.txt 설치가 필요합니다')
    ensure_queue_dirs(config.root)
    lock = acquire_lock(config.root)
    running = True
    def stop(_signum, _frame):
        nonlocal running
        running = False
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log('info', 'remote_worker_started')
    try:
        while running:
            try:
                job = api(config, '/jobs/claim', {})
                if job:
                    result = process(job, config)
                    log('info', 'remote_job_finished', job_id=job['id'], status=result.get('status', 'completed'))
                    continue
            except Exception as error:
                log('error', 'remote_worker_error', error_type=type(error).__name__)
            time.sleep(config.poll_interval_ms / 1000)
    finally:
        lock.close()


if __name__ == '__main__':
    main()
