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


# 저널에만 남길 진단 문구의 길이. 서버·Discord로는 나가지 않는다.
DIAGNOSTIC_MAX = 300


# 다시 받아도 결과가 같은 실패. 재시도 코드(DOWNLOAD_FAILED)로 두면 서버가 계속
# queued로 되돌려 6시간마다 같은 곡을 다시 받는다. 그런 곡이 몇 개만 쌓여도 워커가
# 연속 실패로 휴지에 들어가 멀쩡한 곡이 밀린다 — 2026-09-12에
# 'This video is unavailable' 9곡이 큐를 막았다.
SOURCE_GONE = (
    'video has been removed', 'removed by the uploader',
    'video is private', 'private video',
    'video is unavailable', 'video unavailable', 'no longer available',
    'has been terminated',
    'this track was not found', 'copyright claim',
    # DRM 우회는 지원하지 않는다(가드레일). SoundCloud Go+ 전용 트랙이 여기 걸린다.
    'drm protected',
    # 지역 차단은 이 미니PC에서 몇 번을 받아도 같은 결과다. yt-dlp가 여러 문장으로
    # 알리므로("...has not made this video available in your country",
    # "...has blocked it in your country") 공통 조각으로 잡는다.
    'in your country',
)


def error_hint(error):
    """왜 실패했는지 한 줄로 요약한다. 저널에만 남는다.

    DOWNLOAD_FAILED는 분류에 걸리지 않은 것을 모두 받는 통이라, 원문을 남기지
    않으면 같은 곡이 반복해 실패해도 이유를 알 방법이 없다.
    """
    raw = getattr(error, 'stderr', b'') or b''
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8', errors='replace')
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if not lines:
        return type(error).__name__
    # yt-dlp는 ERROR 줄에 이유를 적는다. 없으면 마지막 줄을 쓴다.
    picked = next((line for line in lines if line.startswith('ERROR')), lines[-1])
    return picked[:DIAGNOSTIC_MAX]


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
    if any(v in message for v in SOURCE_GONE):
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


def download_audio(platform, track_key, directory, runner=subprocess.run):
    """길이 한도를 통과한 곡만 wav로 받는다.

    길이·라이브 여부는 `--match-filter`가 **받기 전에** 본다. 예전에는 같은 검사를
    `--skip-download` yt-dlp 호출로 한 번 더 했는데, 추출을 두 번 하느라 2.5초를
    더 쓰면서 걸러내는 곡은 같았다. 신청한 사람이 기다리는 경로라 그 시간이 그대로
    체감된다.

    받는 속도를 늦추던 `--sleep-interval`도 뺐다. 워커는 한 곡을 받아 분석까지
    끝내는 데 100초 넘게 쓰고(실측 중앙값 약 125초) 그동안 다음 곡을 받지 않으므로,
    2~5초를 더 자는 것은 요청 지연만 늘렸다.
    """
    url = source_url(platform, track_key)
    directory = Path(directory)
    command = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-playlist',
               '--no-cache-dir', '--no-progress', '--quiet', '--socket-timeout', '20',
               '--retries', '2', '--fragment-retries', '2', '--max-filesize', str(MAX_BYTES),
               '--match-filter', f'duration >= {MIN_DURATION} & duration <= {MAX_DURATION} & !is_live',
               '--format', 'bestaudio/best', '--extract-audio', '--audio-format', 'wav',
               '--postprocessor-args', 'ExtractAudio+ffmpeg_o:-ac 1 -ar 16000', '--output', str(directory / 'audio.%(ext)s'),
               '--', url]
    try:
        runner(command, check=True, timeout=300, capture_output=True)
    except (subprocess.SubprocessError, OSError) as error:
        # 외부 출력은 URL 등이 포함될 수 있으므로 API에는 고정 코드만 보낸다.
        raise DownloadError(classify_error(error)) from error
    files = [p for p in directory.glob('audio.*') if p.suffix not in ('.part', '.ytdl') and p.is_file()]
    if not files:
        # yt-dlp가 정상 종료했는데 파일이 없으면 받기를 시작하지도 않은 것이다.
        # 그렇게 되는 경우는 --match-filter(길이·라이브)와 --max-filesize뿐이고,
        # 셋 다 다시 받아도 결과가 같다. DOWNLOAD_FAILED로 두면 서버가 일시 장애로
        # 보고 6시간마다 같은 곡을 영원히 다시 시도한다 — 148분짜리 플레이리스트가
        # 큐를 막았던 것이 이 경로다.
        raise DownloadError('SOURCE_UNSUPPORTED')
    if len(files) != 1 or files[0].suffix != '.wav' or not 0 < files[0].stat().st_size <= MAX_BYTES:
        raise DownloadError('DOWNLOAD_FAILED')
    return files[0]
