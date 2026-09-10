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
import urllib.parse
import urllib.request
from pathlib import Path

APPLE_FEED = 'https://rss.applemarketingtools.com/api/v2/{country}/music/most-played/{limit}/songs.json'
# 곡(recording) 단위로 조회한다. 릴리스(앨범) 단위로 검색하면 YouTube에서 풀앨범
# 업로드가 잡힌다 — 실측에서 8곡 중 3곡이 앨범 전체였다.
MUSICBRAINZ_URL = 'https://musicbrainz.org/ws/2/recording'
# 매칭한 영상 길이가 이만큼 넘게 다르면 다른 곡으로 본다. MusicBrainz가 곡 길이를
# 주므로 Apple 소스에는 없는 검증을 할 수 있다.
DURATION_TOLERANCE_SEC = 20
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


def fetch_musicbrainz_kr(window, opener=urllib.request.urlopen):
    """한국 발매 곡을 날짜 구간으로 가져온다. 곡 길이도 함께 준다."""
    params = urllib.parse.urlencode({
        'query': f"country:KR AND firstreleasedate:[{window['from']} TO {window['to']}]",
        'fmt': 'json', 'limit': 100,
    })
    request = urllib.request.Request(f'{MUSICBRAINZ_URL}?{params}',
                                     headers={'User-Agent': USER_AGENT})
    try:
        with opener(request, timeout=FETCH_TIMEOUT) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except Exception as error:
        raise DiscoveryError('SOURCE_FETCH_FAILED') from error

    rows, seen = [], set()
    for item in payload.get('recordings', []):
        title = item.get('title') or ''
        artist = ((item.get('artist-credit') or [{}])[0].get('name') or '')
        # 인스트루멘털은 같은 곡의 다른 버전이라 분석 예산만 쓴다.
        if not title or '(inst.)' in title.lower():
            continue
        if (artist, title) in seen:
            continue
        seen.add((artist, title))
        length = item.get('length')
        rows.append({'artist': artist, 'title': title,
                     'expected_sec': (length // 1000) if length else None})
    return rows


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


def find_youtube_id(artist, title, runner=subprocess.run, expected_sec=None):
    """곡 하나를 YouTube에서 찾는다. 못 찾으면 None.

    기대 길이를 알면 그것과 크게 다른 결과를 버린다. 동명이인이나 풀앨범 업로드를
    거르는 유일한 장치다.
    """
    query = f'{artist} {title}'.strip()
    if not query:
        return None
    entries = _yt_dlp([f'ytsearch3:{query}' if expected_sec else f'ytsearch1:{query}'],
                      runner).get('entries') or []
    for entry in entries:
        video_id = entry.get('id')
        if not video_id or len(video_id) != 11:
            continue
        # 길이를 아는 경우에만 거른다. 검색 결과가 길이를 안 주는 경우가 있다.
        duration = entry.get('duration')
        if duration is not None and not MIN_DURATION <= duration <= MAX_DURATION:
            continue
        if expected_sec and duration is not None and abs(duration - expected_sec) > DURATION_TOLERANCE_SEC:
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


def collect(source, query, limit, offset=0, window=None,
            runner=subprocess.run, opener=urllib.request.urlopen):
    """요청 하나를 처리해 분석 큐에 넣을 곡 목록과 실제로 훑은 개수를 돌려준다.

    `offset`부터 `limit`개를 본다. 돌려주는 `scanned`가 `limit`보다 작으면 소스를
    끝까지 본 것이라, 서버가 다음 요청을 처음부터 다시 시작한다.
    """
    offset = max(0, int(offset))
    limit = int(limit)
    if source == 'musicbrainz_kr':
        if not window:
            # 서버가 백필 하한에 닿았다고 판단하면 창을 주지 않는다.
            return [], 0
        rows = fetch_musicbrainz_kr(window, opener=opener)[:limit]
        tracks = []
        for item in rows:
            video_id = find_youtube_id(item['artist'], item['title'], runner, item['expected_sec'])
            if video_id:
                tracks.append({'platform': 'youtube', 'track_key': video_id,
                               'title': item['title'][:500],
                               'artist_name': (item['artist'] or 'unknown')[:200]})
        # 날짜 창은 순위처럼 이어 붙이지 않는다. 창을 다 본 것이므로 limit을 채운 것으로 본다.
        return tracks, limit
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
