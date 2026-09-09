#!/usr/bin/env python3
"""실제 다운로드·MAEST 파이프라인을 서버 쓰기 없이 시험하는 CLI."""
import argparse
import json
import time
from pathlib import Path
from download import source_url
from remote_worker import process


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=['youtube', 'soundcloud'], required=True)
    parser.add_argument('--track-key', required=True, help='YouTube ID 또는 SoundCloud 단일 곡 URL')
    parser.add_argument('--title', default='테스트 곡')
    parser.add_argument('--artist', default='unknown')
    parser.add_argument('--output', type=Path, required=True, help='원본 결과를 저장할 JSON 파일')
    args = parser.parse_args()
    start = time.monotonic()
    job = {'id': 'local-test', 'lease_token': 'local-test', 'platform': args.platform,
           'track_key': args.track_key, 'artist_name': args.artist}

    def capture(_config, endpoint, body):
        if endpoint.endswith('/fail'):
            raise RuntimeError(body['error_code'])
        body.pop('lease_token', None)
        body['test_input'] = {'title': args.title, 'url': source_url(args.platform, args.track_key)}
        body['elapsed_sec'] = round(time.monotonic() - start, 2)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding='utf-8')
        raw = body['maest_run']['maest_raw']
        rows = sorted(zip(raw['classes'], raw['mean'], raw['max']), key=lambda row: -row[1])[:10]
        print(json.dumps({'input': body['test_input'], 'elapsed_sec': body['elapsed_sec'],
                          'segments': len(raw['segments']), 'top_mean': [dict(zip(['label', 'mean', 'max'], r)) for r in rows],
                          'annotation': body['automatic_annotation'], 'output': str(args.output)}, ensure_ascii=False, indent=2))
        return {'status': 'completed'}

    process(job, None, call=capture)


if __name__ == '__main__':
    main()
