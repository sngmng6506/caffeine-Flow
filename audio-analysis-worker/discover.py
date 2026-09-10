"""최신곡 목록을 모아 분석 큐에 넣을 후보를 만든다.

곡 목록 조회와 플랫폼 검색을 워커가 맡는 이유는 두 가지다. 서버에 yt-dlp가 없고,
Railway 공용 IP에서 검색을 반복하면 막힐 수 있다.

곡 중복은 여기서 걸러내지 않는다. 서버 `jobs.enqueue`가 (platform, track_key)
unique로 무시한다.

대신 서버가 소스별 진도(offset)를 들고 있어, 버튼을 누를 때마다 같은 상위 N을
다시 훑지 않고 다음 구간을 본다. 끝까지 보면 처음으로 돌아가므로 차트에 뒤늦게
오른 곡도 다음 바퀴에서 잡힌다.
"""

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

APPLE_FEED = 'https://rss.applemarketingtools.com/api/v2/{country}/music/most-played/{limit}/songs.json'
APPLE_COUNTRY = 'kr'
USER_AGENT = 'caffeine-flow-audio-worker/1.0'
FETCH_TIMEOUT = 30
SEARCH_TIMEOUT = 120

# 길이 한도는 분석 파이프라인과 같은 계약을 쓴다. 한도를 벗어난 곡을 큐에 넣으면
# 워커가 받아서 곧바로 영구 실패시키는 낭비가 생긴다.
_CONTRACT = json.loads(
    (Path(__file__).resolve().parents[1] / 'server/src/constants/audio-pipeline.json').read_text()
)
MIN_DURATION = _CONTRACT['audio_duration_sec']['min']
MAX_DURATION = _CONTRACT['audio_duration_sec']['max']


class DiscoveryError(RuntimeError):
    """수집에 실패했을 때. 서버에 고정 코드만 보낸다."""


def fetch_apple_chart(limit, country=APPLE_COUNTRY, opener=urllib.request.urlopen):
    """Apple 차트에서 아티스트·곡명·발매일을 가져온다."""
    url = APPLE_FEED.format(country=country, limit=max(1, min(int(limit), 100)))
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with opener(request, timeout=FETCH_TIMEOUT) as response:
            feed = json.loads(response.read().decode('utf-8'))['feed']
    except Exception as error:
        raise DiscoveryError('SOURCE_FETCH_FAILED') from error
    return [{'artist': item.get('artistName', ''), 'title': item.get('name', ''),
             'released_at': item.get('releaseDate')}
            for item in feed.get('results', []) if item.get('name')]


def _yt_dlp(args, runner=subprocess.run, timeout=SEARCH_TIMEOUT):
    command = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-cache-dir',
               '--quiet', '--no-warnings', '-J', '--flat-playlist', *args]
    try:
        completed = runner(command, capture_output=True, timeout=timeout, check=True)
    except (subprocess.SubprocessError, OSError) as error:
        raise DiscoveryError('SEARCH_FAILED') from error
    raw = completed.stdout
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8', errors='replace')
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise DiscoveryError('SEARCH_FAILED') from error


def find_youtube_id(artist, title, runner=subprocess.run):
    """곡 하나를 YouTube에서 찾는다. 못 찾으면 None."""
    query = f'{artist} {title}'.strip()
    if not query:
        return None
    entries = _yt_dlp([f'ytsearch1:{query}'], runner).get('entries') or []
    for entry in entries:
        video_id = entry.get('id')
        if not video_id or len(video_id) != 11:
            continue
        # 길이를 아는 경우에만 거른다. 검색 결과가 길이를 안 주는 경우가 있다.
        duration = entry.get('duration')
        if duration is not None and not MIN_DURATION <= duration <= MAX_DURATION:
            continue
        return video_id
    return None


def search_soundcloud(query, limit, runner=subprocess.run):
    """SoundCloud 검색 결과를 재생 수 기준으로 추린다.

    플랫폼 자체가 인디라 따로 무명 필터가 필요 없다. 대신 믹스·DJ 셋이 많이 섞이므로
    길이로 먼저 걸러낸 뒤 인기순으로 자른다.
    """
    # 인기순 정렬을 검색이 지원하지 않아 넉넉히 받아 후처리한다.
    entries = _yt_dlp([f'scsearch{max(1, min(int(limit) * 4, 100))}:{query}'], runner,
                      timeout=SEARCH_TIMEOUT * 2).get('entries') or []
    usable = []
    for entry in entries:
        url, duration = entry.get('url'), entry.get('duration')
        if not url or duration is None:
            continue
        if not MIN_DURATION <= duration <= MAX_DURATION:
            continue
        usable.append({
            'platform': 'soundcloud', 'track_key': url,
            'title': (entry.get('title') or '')[:500],
            'artist_name': (entry.get('uploader') or entry.get('channel') or 'unknown')[:200],
            'plays': entry.get('view_count') or 0,
        })
    usable.sort(key=lambda track: -track['plays'])
    return [{k: v for k, v in track.items() if k != 'plays'} for track in usable[:int(limit)]]


# Apple 차트가 한 번에 주는 최대 곡 수. 그 이상은 서버가 500을 준다.
APPLE_FEED_MAX = 100


def collect(source, query, limit, offset=0, runner=subprocess.run, opener=urllib.request.urlopen):
    """요청 하나를 처리해 분석 큐에 넣을 곡 목록과 실제로 훑은 개수를 돌려준다.

    `offset`부터 `limit`개를 본다. 돌려주는 `scanned`가 `limit`보다 작으면 소스를
    끝까지 본 것이라, 서버가 다음 요청을 처음부터 다시 시작한다.
    """
    offset = max(0, int(offset))
    limit = int(limit)
    if source == 'soundcloud':
        candidates = search_soundcloud(query, offset + limit, runner)
    elif source == 'apple_kr':
        chart = fetch_apple_chart(APPLE_FEED_MAX, opener=opener)
        candidates = chart[offset:offset + limit]
        tracks = []
        for item in candidates:
            video_id = find_youtube_id(item['artist'], item['title'], runner)
            if video_id:
                tracks.append({'platform': 'youtube', 'track_key': video_id,
                               'title': item['title'][:500],
                               'artist_name': (item['artist'] or 'unknown')[:200]})
        return tracks, len(candidates)
    else:
        raise DiscoveryError('SOURCE_UNSUPPORTED')

    window = candidates[offset:offset + limit]
    return window, len(window)
