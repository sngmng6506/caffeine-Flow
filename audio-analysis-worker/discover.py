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
import re
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
# Apple 피드는 국가 코드가 필수다. `global`·`ww`는 500이라 전 세계 통합 차트가
# 없다. 대신 국가를 돌아가며 본다 — 한 나라를 다 보면 다음 나라로 넘어간다.
# 음악 시장이 큰 순으로 골랐고, 언어권이 겹치지 않게 섞었다.
APPLE_COUNTRIES = ('kr', 'us', 'jp', 'gb', 'de', 'fr', 'br', 'mx', 'id', 'au')
APPLE_COUNTRY = APPLE_COUNTRIES[0]

# SoundCloud 내부 차트(`/charts`)는 죽었고 지역 필터도 API에서 사라졌다. 살아 있는
# 것은 장르별 인기 플레이리스트뿐이라 그것을 돈다. 장르가 갈려 있어 한 소스로
# 여러 장르를 고르게 가져온다 — 지금 DB가 K-pop에 몰려 있는 것을 푸는 것이 목적이다.
SOUNDCLOUD_API = 'https://api-v2.soundcloud.com'
SOUNDCLOUD_PAGE = 'https://soundcloud.com/discover'
# 한 장르 플레이리스트가 담는 곡 수. 커서를 장르로 나누는 기준이다.
SOUNDCLOUD_BUCKET = 50
# 트랙 메타를 한 번에 조회할 개수. URL 길이 때문에 너무 키우지 않는다.
SOUNDCLOUD_ID_BATCH = 25
USER_AGENT = 'caffeine-flow-audio-worker/1.0'
# SoundCloud 웹 자산은 브라우저가 아닌 UA에 다르게 응답한다.
BROWSER_AGENT = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                '(KHTML, like Gecko) Chrome/131.0 Safari/537.36')
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


def fetch_musicbrainz_kr(window, opener=urllib.request.urlopen, offset=0, limit=100):
    """한국 발매 곡을 날짜 구간으로 가져온다. 곡 길이도 함께 준다."""
    params = urllib.parse.urlencode({
        'query': f"country:KR AND firstreleasedate:[{window['from']} TO {window['to']}]",
        'fmt': 'json', 'limit': limit, 'offset': offset,
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
    return {'rows': rows, 'scanned': len(payload.get('recordings', []))}


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


def _soundcloud_client_id(opener=urllib.request.urlopen):
    """웹 번들에 박힌 client_id를 긁는다.

    공식 발급 경로가 없어 이 방법뿐이다. 새로 생기는 의존은 아니다 — 손님이 신청한
    SoundCloud 곡을 받을 때 yt-dlp가 이미 같은 일을 한다.
    """
    def read(url):
        request = urllib.request.Request(url, headers={'User-Agent': BROWSER_AGENT})
        with opener(request, timeout=FETCH_TIMEOUT) as response:
            return response.read().decode('utf-8', errors='replace')
    try:
        scripts = re.findall(r'src="(https://a-v2\.sndcdn\.com/assets/[^"]+\.js)"', read(SOUNDCLOUD_PAGE))
        for source in reversed(scripts):
            found = re.search(r'client_id\s*:\s*"([A-Za-z0-9]{20,})"', read(source))
            if found:
                return found.group(1)
    except Exception as error:
        raise DiscoveryError('SOURCE_FETCH_FAILED') from error
    raise DiscoveryError('SOURCE_FETCH_FAILED')


def _soundcloud_get(path, params, client_id, opener=urllib.request.urlopen):
    query = urllib.parse.urlencode({**params, 'client_id': client_id})
    request = urllib.request.Request(f'{SOUNDCLOUD_API}/{path}?{query}',
                                     headers={'User-Agent': BROWSER_AGENT})
    try:
        with opener(request, timeout=FETCH_TIMEOUT) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as error:
        raise DiscoveryError('SOURCE_FETCH_FAILED') from error


def fetch_soundcloud_genres(client_id, opener=urllib.request.urlopen):
    """장르별 인기 플레이리스트 목록. 제목과 트랙 ID만 쓴다."""
    data = _soundcloud_get('mixed-selections', {'limit': 20}, client_id, opener)
    for selection in (data.get('collection') or []):
        if 'genre' not in str(selection.get('title') or '').lower():
            continue
        playlists = ((selection.get('items') or {}).get('collection') or [])
        return [{'title': str(item.get('title') or ''),
                 'track_ids': [t.get('id') for t in (item.get('tracks') or []) if t.get('id')]}
                for item in playlists if item.get('tracks')]
    return []


def fetch_soundcloud_tracks(track_ids, client_id, opener=urllib.request.urlopen):
    """트랙 ID 묶음을 메타로 바꾼다. 곡별 재조회 없이 한 번에 온다."""
    rows = []
    for start in range(0, len(track_ids), SOUNDCLOUD_ID_BATCH):
        chunk = track_ids[start:start + SOUNDCLOUD_ID_BATCH]
        data = _soundcloud_get('tracks', {'ids': ','.join(str(i) for i in chunk)}, client_id, opener)
        rows.extend(data if isinstance(data, list) else [])
    return rows


def collect_soundcloud(offset, limit, opener=urllib.request.urlopen):
    """장르 하나를 훑는다. 누를 때마다 다음 장르로 넘어간다.

    SoundCloud는 곡 URL이 곧 track_key라 YouTube 검색을 거치지 않는다.
    """
    client_id = _soundcloud_client_id(opener)
    genres = fetch_soundcloud_genres(client_id, opener)
    if not genres:
        raise DiscoveryError('SOURCE_FETCH_FAILED')
    genre = genres[(offset // SOUNDCLOUD_BUCKET) % len(genres)]
    within = offset % SOUNDCLOUD_BUCKET
    wanted = genre['track_ids'][within:within + limit]
    if not wanted:
        return [], 0
    tracks = []
    for row in fetch_soundcloud_tracks(wanted, client_id, opener):
        url = row.get('permalink_url')
        duration = round((row.get('duration') or 0) / 1000)
        # 믹스·DJ 셋을 길이로 거른다. 한도를 벗어난 곡을 큐에 넣으면 워커가 받아서
        # 곧바로 영구 실패시키는 낭비가 생긴다.
        if not url or not MIN_DURATION <= duration <= MAX_DURATION:
            continue
        tracks.append({'platform': 'soundcloud', 'track_key': url,
                       'title': (row.get('title') or '')[:500],
                       'artist_name': ((row.get('user') or {}).get('username') or 'unknown')[:200]})
    return tracks, len(wanted)


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
        page = fetch_musicbrainz_kr(window, opener=opener, offset=offset, limit=limit)
        rows = page['rows']
        tracks = []
        for item in rows:
            video_id = find_youtube_id(item['artist'], item['title'], runner, item['expected_sec'])
            if video_id:
                tracks.append({'platform': 'youtube', 'track_key': video_id,
                               'title': item['title'][:500],
                               'artist_name': (item['artist'] or 'unknown')[:200]})
        # 제외·매칭 실패도 원본 페이지 위치에는 포함한다. 같은 영상은 한 번만 제출한다.
        tracks = list({track['track_key']: track for track in tracks}.values())
        return tracks, page['scanned']
    if source == 'soundcloud_trending':
        return collect_soundcloud(offset, limit, opener=opener)
    if source == 'apple_global':
        # 한 나라를 다 보면 다음 나라로 넘어간다. 국가 수를 넘어가면 처음으로 돈다.
        country = APPLE_COUNTRIES[(offset // APPLE_FEED_MAX) % len(APPLE_COUNTRIES)]
        within = offset % APPLE_FEED_MAX
        chart = fetch_apple_chart(APPLE_FEED_MAX, country=country, opener=opener)
        candidates = chart[within:within + limit]
        tracks = []
        for item in candidates:
            video_id = find_youtube_id(item['artist'], item['title'], runner)
            if video_id:
                tracks.append({'platform': 'youtube', 'track_key': video_id,
                               'title': item['title'][:500],
                               'artist_name': (item['artist'] or 'unknown')[:200]})
        # 국가가 남아 있으면 소스가 바닥난 것이 아니다. 서버가 커서를 되감지 않도록
        # 요청한 만큼 훑은 것으로 보고한다.
        scanned = limit if len(candidates) < limit else len(candidates)
        return tracks, scanned
    # 소스 목록에서는 빠졌지만 이미 큐에 들어간 요청이 있을 수 있다.
    if source == 'apple_kr':
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
    raise DiscoveryError('SOURCE_UNSUPPORTED')
