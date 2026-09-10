"""서버 확인 전 결과를 삭제하지 않는 디스크 전송함. 오디오는 보관하지 않는다."""
import json
import os
import uuid
from pathlib import Path
from urllib.error import HTTPError


def sync_dir(path):
    descriptor = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save(config, job, endpoint, payload):
    directory = Path(config.root) / 'outbox'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / f'{uuid.uuid4()}.json'
    temporary = path.with_suffix('.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        os.chmod(temporary, 0o600)
        json.dump({'job_id': job['id'], 'server_url': config.server_url,
                   'endpoint': endpoint, 'payload': payload}, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    sync_dir(directory)
    return path


def deliver(path, config, call):
    entry = json.loads(path.read_text(encoding='utf-8'))
    if entry['server_url'] != config.server_url:
        raise RuntimeError('OUTBOX_SERVER_MISMATCH')
    try:
        resumed = call(config, f"/jobs/{entry['job_id']}/resume", {'lease_token': entry['payload']['lease_token']})
        response = resumed if resumed.get('status') == 'completed' else call(config, entry['endpoint'], entry['payload'])
    except HTTPError as error:
        if error.code == 409:
            # 인계·관리자 재실행으로 폐기된 lease는 새 작업에 덮어쓰지 않고 원본을 남긴다.
            directory = path.parent / 'superseded'
            directory.mkdir(exist_ok=True, mode=0o700)
            os.replace(path, directory / path.name)
            sync_dir(directory)
            sync_dir(path.parent)
            return {'status': 'superseded'}
        raise
    path.unlink()
    sync_dir(path.parent)
    return response


def drain(config, call):
    for path in sorted((Path(config.root) / 'outbox').glob('*.json')):
        deliver(path, config, call)
