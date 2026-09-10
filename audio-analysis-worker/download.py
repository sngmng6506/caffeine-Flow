"""지원 플랫폼의 단일 곡만 임시 폴더로 받는다. 쿠키·DRM 우회는 하지 않는다."""
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

# 길이 한도는 서버 검증과 같은 값이어야 한다. 양쪽에 따로 적지 않고 계약을 읽는다.
_CONTRACT = json.loads(
    (Path(__file__).resolve().parents[1] / 'server/src/constants/audio-pipeline.json').read_text()
)
MIN_DURATION = _CONTRACT['audio_duration_sec']['min']
MAX_DURATION = _CONTRACT['audio_duration_sec']['max']
MAX_BYTES = 200 * 1024 * 1024


class DownloadError(RuntimeError):
    pass


def classify_error(error):
    # 원문은 외부로 보내지 않고 일시 장애·영구 소스 오류·공통 환경 장애만 분류한다.
    message = (getattr(error, 'stderr', b'') or b'')
    if isinstance(message, bytes):
        message = message.decode('utf-8', errors='replace')
    message = message.lower()
    if isinstance(error, FileNotFoundError) or any(v in message for v in (
            'certificate_verify_failed', 'ffmpeg not found', 'ffprobe not found',
            'ffprobe and ffmpeg not found', 'sign in to confirm', 'http error 429')):
        return 'DOWNLOAD_INFRASTRUCTURE'
    if any(v in message for v in ('video has been removed', 'video is private',
                                 'private video', 'this track was not found', 'copyright claim')):
        return 'SOURCE_UNAVAILABLE'
    return 'DOWNLOAD_FAILED'



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


def probe_duration(url, runner=subprocess.run):
    """오디오를 받기 전에 길이만 확인한다.

    10분을 넘는 것은 대개 플레이리스트·믹스라 곡 단위 분석 대상이 아니다. 받아 본
    뒤 실패로 처리하면 서버가 일시 장애로 보고 6시간마다 영원히 다시 시도한다.
    미리 걸러 영구 실패로 보내면 그 반복이 사라진다.
    """
    command = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-playlist',
               '--no-cache-dir', '--quiet', '--skip-download', '--socket-timeout', '20',
               '--print', '%(duration)s|%(is_live)s', '--', url]
    try:
        completed = runner(command, check=True, timeout=120, capture_output=True)
    except (subprocess.SubprocessError, OSError) as error:
        raise DownloadError(classify_error(error)) from error
    raw = (completed.stdout or b'')
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8', errors='replace')
    duration, _, live = raw.strip().partition('|')
    if live.strip().lower() == 'true':
        raise DownloadError('SOURCE_UNSUPPORTED')
    try:
        seconds = float(duration)
    except ValueError:
        # 길이를 못 읽는 소스가 있다. 그때는 막지 않고 받아 보되 match-filter가 다시 본다.
        return None
    if not MIN_DURATION <= seconds <= MAX_DURATION:
        raise DownloadError('SOURCE_UNSUPPORTED')
    return seconds


def download_audio(platform, track_key, directory, runner=subprocess.run):
    url = source_url(platform, track_key)
    probe_duration(url, runner)
    directory = Path(directory)
    command = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-playlist',
               '--no-cache-dir', '--no-progress', '--quiet', '--socket-timeout', '20',
               '--retries', '2', '--fragment-retries', '2', '--max-filesize', str(MAX_BYTES),
               '--match-filter', f'duration >= {MIN_DURATION} & duration <= {MAX_DURATION} & !is_live',
               '--sleep-interval', '2', '--max-sleep-interval', '5',
               '--format', 'bestaudio/best', '--extract-audio', '--audio-format', 'wav',
               '--postprocessor-args', 'ExtractAudio+ffmpeg_o:-ac 1 -ar 16000', '--output', str(directory / 'audio.%(ext)s'),
               '--', url]
    try:
        runner(command, check=True, timeout=300, capture_output=True)
    except (subprocess.SubprocessError, OSError) as error:
        # 외부 출력은 URL 등이 포함될 수 있으므로 API에는 고정 코드만 보낸다.
        raise DownloadError(classify_error(error)) from error
    files = [p for p in directory.glob('audio.*') if p.suffix not in ('.part', '.ytdl') and p.is_file()]
    if len(files) != 1 or files[0].suffix != '.wav' or not 0 < files[0].stat().st_size <= MAX_BYTES:
        raise DownloadError('DOWNLOAD_FAILED')
    return files[0]
