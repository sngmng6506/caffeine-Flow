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
from discover import DiscoveryError, collect
from download import download_audio, DownloadError, error_hint
from maest import verify_tag_model, CONTRACT
import outbox
from worker import WorkerConfig, ensure_queue_dirs, acquire_lock, log


def api(config, path, body):
    request = Request(config.server_url + '/api/v1/audio-analysis' + path,
                      data=json.dumps(body).encode(), method='POST',
                      headers={'Authorization': f'Bearer {config.token}', 'Content-Type': 'application/json'})
    with urlopen(request, timeout=30) as response:
        return None if response.status == 204 else json.loads(response.read())


def submit(config, job, endpoint, payload, call):
    if config is None:
        return call(config, endpoint, payload)  # 서버를 쓰지 않는 단독 테스트
    path = outbox.save(config, job, endpoint, payload)
    return outbox.deliver(path, config, call)


def process(job, config, call=api, downloader=download_audio, runner=subprocess.run):
    # 실패·성공 어느 쪽에서도 임시 음원을 삭제한다. 원본을 결과 서버에 보내지 않는다.
    with tempfile.TemporaryDirectory(prefix='cf-audio-') as directory:
        root = Path(directory)
        try:
            audio = downloader(job['platform'], job['track_key'], root)
        except DownloadError as error:
            code = str(error)
            # 분류 코드만으로는 같은 곡이 왜 계속 실패하는지 알 수 없다. 원인 줄은
            # 저널에만 남기고 서버·Discord로 내보내지 않는다.
            log('warning', 'download_failed', job_id=job['id'], error_code=code,
                hint=error_hint(error.__cause__ or error))
            result = submit(config, job, f"/jobs/{job['id']}/fail", {'lease_token': job['lease_token'], 'error_code': code}, call)
            return {**(result or {}), 'error_code': code}
        job_file, output = root / 'job.json', root / 'result.json'
        # 인증 토큰은 모델 프로세스의 작업 파일·명령 인자에 쓰지 않는다.
        # 3단 실행 여부와 프롬프트는 서버가 정한다. 워커 파일로 두면 미니PC에 접속해
        # 고치고 재시작해야 한다. claim 응답에 실려 오는 값을 그대로 넘긴다.
        job_file.write_text(json.dumps({
            **{k: job[k] for k in ('platform', 'track_key', 'artist_name')},
            'audio_llm_enabled': job.get('audio_llm_enabled', True),
            'audio_llm_prompt': job.get('audio_llm_prompt'),
        }))
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
            result = submit(config, job, f"/jobs/{job['id']}/fail", {'lease_token': job['lease_token'], 'error_code': code}, call)
            return {**(result or {}), 'error_code': code}
        payload['lease_token'] = job['lease_token']
        return submit(config, job, f"/jobs/{job['id']}/complete", payload, call)


def run_discovery(config, collector=collect):
    """수집 요청이 있으면 하나 처리한다. 처리했으면 True."""
    request = api(config, '/discoveries/claim', {})
    if not request:
        return False
    log('info', 'discovery_claimed', discovery_id=request['id'], source=request['source'])
    try:
        tracks, scanned = collector(request['source'], request.get('query'),
                                    request['requested_limit'], request.get('offset', 0),
                                    request.get('window'))
    except DiscoveryError as error:
        api(config, f"/discoveries/{request['id']}/fail",
            {'lease_token': request['lease_token'], 'error_code': str(error)})
        log('warning', 'discovery_failed', discovery_id=request['id'], error_code=str(error))
        return True
    result = api(config, f"/discoveries/{request['id']}/complete",
                 {'lease_token': request['lease_token'], 'tracks': tracks,
                  'offset': request.get('offset', 0), 'scanned': scanned,
                  'window': request.get('window'), 'page_schema_version': 1})
    log('info', 'discovery_finished', discovery_id=request['id'], source=request['source'],
        offset=request.get('offset', 0), scanned=scanned, found=len(tracks),
        added=(result or {}).get('enqueued_count'))
    return True


def main():
    config = WorkerConfig(os.environ).require()
    if config.dry_run:
        raise ValueError('서버 큐에서는 dry-run을 지원하지 않습니다. CLI --dry-run을 사용하세요.')
    ensure_queue_dirs(config.root)
    lock = acquire_lock(config.root)
    running = True
    def stop(_signum, _frame):
        nonlocal running
        running = False
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log('info', 'remote_worker_started')
    models_ready = False
    failures = 0
    retry_after = 0
    try:
        while running:
            if time.monotonic() < retry_after:
                time.sleep(min(1, retry_after - time.monotonic()))
                continue
            try:
                for entry in outbox.drain(config, api):
                    # 재시도로는 빠져나올 수 없어 옆으로 치운 결과다. 조용히 넘기면
                    # 그 곡이 왜 다시 분석되는지 알 수 없다.
                    log('warning', 'outbox_quarantined', **entry)
                if not models_ready:
                    # 전송함 복구는 모델 설치 여부와 독립적이다. 검증 실패 중에는 새 작업을 받지 않는다.
                    verify_tag_model(config.model_dir)
                    import essentia.standard as standard
                    if not hasattr(standard, 'TensorflowPredictMAEST'):
                        raise RuntimeError('requirements-tensorflow.txt 설치가 필요합니다')
                    models_ready = True
                # 분석 큐가 비었을 때만 수집을 본다. 신청곡 처리가 항상 먼저다.
                job = api(config, '/jobs/claim', {})
                if not job and running and run_discovery(config):
                    continue
                if job:
                    result = process(job, config)
                    log('info', 'remote_job_finished', job_id=job['id'], status=result.get('status', 'completed'), error_code=result.get('error_code'))
                    code = result.get('error_code')
                    # 쉬는 것은 다시 해 보면 될 수도 있는 실패에만 의미가 있다. 영구 실패는
                    # 기다린다고 나아지지 않고, 그런 곡이 몇 개만 있어도 연속 실패로 세면
                    # 워커가 내내 휴지 상태가 되어 멀쩡한 곡이 밀린다.
                    if not code:
                        failures = 0
                    elif code not in CONTRACT['retry']['permanent_codes']:
                        failures += 1
                    if failures >= 3 or code in CONTRACT['retry']['infrastructure_codes']:
                        retry_after = time.monotonic() + CONTRACT['retry']['cooldown_seconds']
                        log('warning', 'remote_worker_cooldown', consecutive_failures=failures)
                    continue
            except Exception as error:
                log('error', 'remote_worker_error', error_type=type(error).__name__, http_status=getattr(error, 'code', None))
                retry_after = time.monotonic() + CONTRACT['retry']['cooldown_seconds']
            time.sleep(config.poll_interval_ms / 1000)
    finally:
        lock.close()


if __name__ == '__main__':
    main()
