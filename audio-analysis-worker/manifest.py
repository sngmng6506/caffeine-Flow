"""작업 디렉터리의 manifest.json을 검증한다.

워커는 사람이 만든 디렉터리를 읽는다. 즉 manifest는 신뢰할 수 없는 입력이며,
특히 `audio_filename`은 작업 디렉터리 밖을 가리키면 안 된다.
"""

import json
from pathlib import Path

# analyze.py의 CLI 선택지와 같은 값을 쓴다. 서버 검증(result.js)도 같은 목록이다.
VALID_PLATFORMS = ("youtube", "soundcloud", "spotify")

# Essentia MonoLoader가 읽을 수 있고 우리가 실제로 다루는 확장자만 받는다.
ALLOWED_EXTENSIONS = (".wav", ".ogg", ".flac", ".mp3", ".m4a")
MAX_AUDIO_BYTES = 200 * 1024 * 1024

MANIFEST_FILENAME = "manifest.json"
REQUIRED_FIELDS = ("platform", "track_key", "audio_filename")


class ManifestError(ValueError):
    """manifest가 계약을 어겼을 때. 해당 작업은 failed로 보낸다."""


def _require_text(raw, field, max_length):
    if not isinstance(raw, str):
        raise ManifestError(f"{field}은(는) 문자열이어야 합니다")
    value = raw.strip()
    if not value:
        raise ManifestError(f"{field}이(가) 비어 있습니다")
    if len(value) > max_length:
        raise ManifestError(f"{field}이(가) 너무 깁니다({max_length}자 제한)")
    return value


def validate_audio_filename(raw):
    """basename만 허용한다. 경로 구분자, 상위 이동, 절대 경로를 모두 막는다."""
    value = _require_text(raw, "audio_filename", 255)
    if value != Path(value).name or value in (".", ".."):
        raise ManifestError("audio_filename은 파일 이름만 허용합니다")
    # Path(...).name은 POSIX에서 역슬래시를 걸러내지 못한다. 윈도우식 경로도 막는다.
    if "/" in value or "\\" in value or "\x00" in value:
        raise ManifestError("audio_filename은 파일 이름만 허용합니다")
    if Path(value).suffix.lower() not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(ALLOWED_EXTENSIONS)
        raise ManifestError(f"지원하지 않는 확장자입니다: 허용 {allowed}")
    return value


def parse_manifest(raw_text):
    """manifest.json 본문을 검증된 dict로 바꾼다."""
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as error:
        raise ManifestError(f"manifest.json을 읽을 수 없습니다: {error.msg}") from error
    if not isinstance(data, dict):
        raise ManifestError("manifest.json은 객체여야 합니다")

    missing = [field for field in REQUIRED_FIELDS if field not in data]
    if missing:
        raise ManifestError(f"manifest에 없는 항목: {', '.join(missing)}")

    platform = _require_text(data["platform"], "platform", 50)
    if platform not in VALID_PLATFORMS:
        raise ManifestError(f"platform이 올바르지 않습니다: {', '.join(VALID_PLATFORMS)}")
    return {
        "platform": platform,
        "track_key": _require_text(data["track_key"], "track_key", 2000),
        "audio_filename": validate_audio_filename(data["audio_filename"]),
    }


def resolve_audio_path(job_dir, audio_filename, max_bytes=MAX_AUDIO_BYTES):
    """검증된 파일 이름을 작업 디렉터리 안의 실제 경로로 바꾼다."""
    directory = Path(job_dir).resolve()
    path = (directory / audio_filename).resolve()
    # 심볼릭 링크로 디렉터리 밖을 가리키는 경우까지 여기서 걸린다.
    if path.parent != directory:
        raise ManifestError("audio_filename이 작업 디렉터리를 벗어납니다")
    if not path.is_file():
        raise ManifestError(f"음원 파일이 없습니다: {audio_filename}")
    size = path.stat().st_size
    if size == 0:
        raise ManifestError("음원 파일이 비어 있습니다")
    if size > max_bytes:
        raise ManifestError(f"음원 파일이 너무 큽니다: {size} > {max_bytes} bytes")
    return path


def load_job(job_dir, max_bytes=MAX_AUDIO_BYTES):
    """작업 디렉터리에서 manifest와 음원 경로를 함께 읽는다."""
    directory = Path(job_dir)
    manifest_path = directory / MANIFEST_FILENAME
    if not manifest_path.is_file():
        raise ManifestError(f"{MANIFEST_FILENAME}이 없습니다")
    manifest = parse_manifest(manifest_path.read_text(encoding="utf-8"))
    audio_path = resolve_audio_path(directory, manifest["audio_filename"], max_bytes=max_bytes)
    return manifest, audio_path
