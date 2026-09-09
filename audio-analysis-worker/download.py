"""지원 플랫폼의 단일 곡만 임시 폴더로 받는다. 쿠키·DRM 우회는 하지 않는다."""
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

MAX_DURATION = 900
MAX_BYTES = 200 * 1024 * 1024


class DownloadError(RuntimeError):
    pass


def source_url(platform, track_key):
    if platform == 'youtube' and re.fullmatch(r'[A-Za-z0-9_-]{11}', track_key):
        return f'https://www.youtube.com/watch?v={track_key}'
    if platform == 'soundcloud':
        url = urlsplit(track_key)
        if (url.scheme == 'https' and url.hostname in ('soundcloud.com', 'www.soundcloud.com')
                and not url.username and not url.password and url.port in (None, 443)
                and re.fullmatch(r'/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/?', url.path)
                and url.path.split('/')[2] != 'sets'):
            return f'https://soundcloud.com{url.path}'
    raise DownloadError('SOURCE_UNSUPPORTED')


def download_audio(platform, track_key, directory):
    url = source_url(platform, track_key)
    directory = Path(directory)
    command = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-playlist',
               '--no-cache-dir', '--no-progress', '--quiet', '--socket-timeout', '20',
               '--retries', '2', '--fragment-retries', '2', '--max-filesize', str(MAX_BYTES),
               '--match-filter', f'duration >= 10 & duration <= {MAX_DURATION} & !is_live',
               '--sleep-interval', '2', '--max-sleep-interval', '5',
               '--format', 'bestaudio/best', '--extract-audio', '--audio-format', 'wav',
               '--postprocessor-args', 'ExtractAudio+ffmpeg_o:-ac 1 -ar 16000', '--output', str(directory / 'audio.%(ext)s'),
               '--', url]
    try:
        subprocess.run(command, check=True, timeout=300, capture_output=True)
    except (subprocess.SubprocessError, OSError) as error:
        # 외부 출력은 URL 등이 포함될 수 있으므로 API에는 고정 코드만 보낸다.
        raise DownloadError('DOWNLOAD_FAILED') from error
    files = [p for p in directory.glob('audio.*') if p.suffix not in ('.part', '.ytdl') and p.is_file()]
    if len(files) != 1 or files[0].suffix != '.wav' or not 0 < files[0].stat().st_size <= MAX_BYTES:
        raise DownloadError('DOWNLOAD_FAILED')
    return files[0]
