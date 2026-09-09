#!/usr/bin/env python3
"""디렉터리 큐를 폴링하며 권리가 확인된 로컬 음원을 한 곡씩 분석하는 상주 워커.

CafeStudy의 소모임 워커와 같은 운영 모델이다. 서버가 미니PC에 접속하지 않고,
미니PC가 Railway로 outbound HTTPS만 보낸다. 사람이 `inbox/<job-id>/`에 음원과
manifest.json을 넣으면 워커가 집어 간다.

    inbox/<job-id>/ ──claim(rename)──> processing/<job-id>/ ──> processed/ | failed/

claim은 `os.rename`이다. 같은 파일시스템 안의 rename은 원자적이라, 사람이 파일을
복사하는 도중에 워커가 집어 가는 일이 없도록 디렉터리 단위로 옮긴다.
"""

import json
import os
import shutil
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from analyze import analyze_audio, build_payload, resolve_emotion_predictor, submit
from audio_llm import (
    DEFAULT_BASE_URL as AUDIO_LLM_DEFAULT_BASE_URL,
    DEFAULT_CLIP_SEC as AUDIO_LLM_DEFAULT_CLIP_SEC,
    DEFAULT_MODEL as AUDIO_LLM_DEFAULT_MODEL,
    DEFAULT_SEGMENTS as AUDIO_LLM_DEFAULT_SEGMENTS,
    DEFAULT_TIMEOUT_SEC as AUDIO_LLM_DEFAULT_TIMEOUT,
)
from emotion import EmotionModelError
from manifest import load_job
from suggestions import build_suggestions

QUEUE_DIRS = ("inbox", "processing", "processed", "failed")
DEFAULT_POLL_INTERVAL_MS = 5000
DEFAULT_ROOT = "~/caffeine-audio"
DEFAULT_MODEL_DIR = "~/caffeine-audio/models"
LOCK_FILENAME = ".worker.lock"
RESULT_FILENAME = "result.json"
ERROR_FILENAME = "error.txt"


def log(level, event, **fields):
    """journald가 그대로 받는 구조화 JSON 한 줄. 토큰·payload는 절대 넣지 않는다."""
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "service": "caffeine-audio-worker",
        "event": event,
        **fields,
    }
    print(json.dumps(record, ensure_ascii=False), flush=True)


class WorkerConfig:
    def __init__(self, env):
        self.server_url = env.get("CAFFEINE_FLOW_SERVER_URL", "").strip().rstrip("/")
        self.token = env.get("AUDIO_ANALYSIS_WORKER_TOKEN", "").strip()
        self.root = Path(env.get("AUDIO_WORKER_ROOT", DEFAULT_ROOT)).expanduser()
        self.model_dir = Path(env.get("AUDIO_MODEL_DIR", DEFAULT_MODEL_DIR)).expanduser()
        self.enable_valence_arousal = read_flag(env, "ENABLE_VALENCE_AROUSAL")
        self.poll_interval_ms = read_positive_int(
            env.get("POLL_INTERVAL_MS"), DEFAULT_POLL_INTERVAL_MS
        )
        self.discord_webhook_url = env.get("DISCORD_AUDIO_WEBHOOK_URL", "").strip()
        # 2단 Audio LLM. 외부 유료 API를 호출하고 오디오 구간이 밖으로 나가므로
        # 기본은 꺼짐이다. 모델은 운영자가 고른다.
        self.enable_audio_llm = read_flag(env, "ENABLE_AUDIO_LLM")
        self.audio_llm = {
            "model": env.get("AUDIO_LLM_MODEL", "").strip() or AUDIO_LLM_DEFAULT_MODEL,
            "base_url": env.get("OPENROUTER_BASE_URL", "").strip() or AUDIO_LLM_DEFAULT_BASE_URL,
            "api_key": env.get("OPENROUTER_API_KEY", "").strip(),
            "app_url": env.get("CAFFEINE_FLOW_SERVER_URL", "").strip(),
            "app_name": env.get("OPENROUTER_APP_NAME", "").strip() or "Caffeine Flow",
            "segments": read_positive_int(env.get("AUDIO_LLM_SEGMENTS"), AUDIO_LLM_DEFAULT_SEGMENTS),
            "clip_sec": read_positive_int(env.get("AUDIO_LLM_CLIP_SEC"), AUDIO_LLM_DEFAULT_CLIP_SEC),
            "timeout_sec": read_positive_int(env.get("AUDIO_LLM_TIMEOUT_SEC"), AUDIO_LLM_DEFAULT_TIMEOUT),
        }
        self.dry_run = read_flag(env, "AUDIO_WORKER_DRY_RUN")

    def require(self):
        if not self.server_url:
            raise ValueError("CAFFEINE_FLOW_SERVER_URL이 필요합니다")
        # 켜 놓고 키가 없으면 곡마다 실패한다. 시작할 때 알린다.
        if self.enable_audio_llm and not self.audio_llm["api_key"]:
            raise ValueError("ENABLE_AUDIO_LLM에는 OPENROUTER_API_KEY가 필요합니다")
        if not self.token and not self.dry_run:
            raise ValueError("AUDIO_ANALYSIS_WORKER_TOKEN이 필요합니다")
        return self


def read_flag(env, name):
    """`true`만 참으로 본다. 오타나 빈 값이 스위치를 켜지 않게 한다."""
    return env.get(name, "").strip().lower() == "true"


def read_positive_int(raw, fallback):
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return fallback
    return value if value > 0 else fallback


def ensure_queue_dirs(root):
    for name in QUEUE_DIRS:
        (root / name).mkdir(parents=True, exist_ok=True)
    return root


def acquire_lock(root):
    """워커 두 개가 같은 큐를 나눠 갖지 않게 막는다. 잠기면 즉시 종료한다."""
    import fcntl

    handle = open(root / LOCK_FILENAME, "w", encoding="utf-8")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as error:
        handle.close()
        raise RuntimeError("다른 워커가 이미 실행 중입니다") from error
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


def next_job_dir(root):
    """inbox에서 가장 오래된 작업 하나를 고른다. 한 번에 한 곡만 분석한다."""
    inbox = root / "inbox"
    candidates = sorted(
        (path for path in inbox.iterdir() if path.is_dir() and not path.name.startswith(".")),
        key=lambda path: (path.stat().st_mtime, path.name),
    )
    return candidates[0] if candidates else None


def claim(job_dir, root):
    """rename으로 원자적으로 소유권을 가져온다. 실패하면 다른 손이 먼저 가져간 것이다."""
    target = root / "processing" / job_dir.name
    if target.exists():
        raise FileExistsError(f"이미 처리 중인 작업입니다: {job_dir.name}")
    os.rename(job_dir, target)
    return target


def finish(job_dir, root, outcome):
    """processing에서 processed/failed로 옮긴다. 같은 이름이 있으면 시각을 붙인다."""
    destination = root / outcome / job_dir.name
    if destination.exists():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        destination = root / outcome / f"{job_dir.name}-{stamp}"
    shutil.move(str(job_dir), str(destination))
    return destination


def notify_discord(webhook_url, job_id, message, timeout=10):
    """실패 알림. CafeStudy 워커와 같은 정책으로, 알림 실패가 작업을 죽이지 않는다."""
    if not webhook_url:
        return False
    content = f"🎧 Caffeine Flow 음향 분석 실패\njob: `{job_id}`\n원인: {message}"[:1900]
    request = Request(
        webhook_url,
        data=json.dumps({"content": content}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout):
            return True
    except (HTTPError, URLError, TimeoutError) as error:
        log("warn", "discord_alert_failed", job_id=job_id, message=str(error)[:200])
        return False


def process_job(job_dir, config, predictor):
    """작업 하나를 끝까지 처리하고 결과 요약을 돌려준다."""
    started = time.monotonic()
    manifest, audio_path = load_job(job_dir)
    features, model_version = analyze_audio(audio_path, predictor)
    payload = build_payload(manifest, features, model_version)
    payload["suggested_annotation"] = build_suggestions(features)

    if config.dry_run:
        saved = {"dry_run": True}
    else:
        saved = submit(config.server_url, config.token, payload)

    elapsed = time.monotonic() - started
    # 결과를 작업 디렉터리에 남긴다. 토큰은 payload에 없다.
    (job_dir / RESULT_FILENAME).write_text(
        json.dumps({"payload": payload, "saved": saved}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {
        "track_key": manifest["track_key"],
        "platform": manifest["platform"],
        "model_version": model_version,
        "valence": features.get("valence"),
        "arousal": features.get("arousal"),
        "bpm": features.get("bpm"),
        "elapsed_seconds": round(elapsed, 2),
    }


def run_once(config, predictor):
    """inbox에 있으면 한 곡 처리하고 True, 없으면 False."""
    job_dir = next_job_dir(config.root)
    if job_dir is None:
        return False

    job_id = job_dir.name
    try:
        claimed = claim(job_dir, config.root)
    except (FileExistsError, OSError) as error:
        log("warn", "job_claim_failed", job_id=job_id, message=str(error)[:200])
        return False

    log("info", "job_claimed", job_id=job_id)
    try:
        summary = process_job(claimed, config, predictor)
    except Exception as error:  # noqa: BLE001 - 어떤 실패든 작업을 failed로 보낸다
        reason = f"{type(error).__name__}: {error}"[:500]
        (claimed / ERROR_FILENAME).write_text(reason, encoding="utf-8")
        finish(claimed, config.root, "failed")
        log("error", "job_failed", job_id=job_id, message=reason)
        notify_discord(config.discord_webhook_url, job_id, reason)
        return True

    finish(claimed, config.root, "processed")
    log("info", "job_succeeded", job_id=job_id, **summary)
    return True


def main():
    config = WorkerConfig(os.environ)
    try:
        config.require()
    except ValueError as error:
        log("error", "worker_start_failed", message=str(error))
        return 1

    ensure_queue_dirs(config.root)
    try:
        lock = acquire_lock(config.root)
    except RuntimeError as error:
        log("error", "worker_start_failed", message=str(error))
        return 1

    # 이전 프로세스의 중단 작업을 무한 재시도하지 않고 실패로 보존한다.
    for abandoned in (config.root / 'processing').iterdir():
        if abandoned.is_dir():
            (abandoned / ERROR_FILENAME).write_text('WORKER_INTERRUPTED', encoding='utf-8')
            finish(abandoned, config.root, 'failed')

    predictor = None
    if config.enable_valence_arousal:
        try:
            predictor = resolve_emotion_predictor(True, config.model_dir)
        except EmotionModelError as error:
            # 분위기를 추측하는 것보다 비워 두는 편이 낫다. 워커는 계속 돈다.
            log("warn", "emotion_model_unavailable", message=str(error)[:300])

    log(
        "info",
        "worker_started",
        server_url=config.server_url,
        root=str(config.root),
        poll_interval_ms=config.poll_interval_ms,
        valence_arousal=predictor is not None,
        dry_run=config.dry_run,
    )

    running = True

    def stop(signum, _frame):
        nonlocal running
        running = False
        log("info", "worker_stopping", signal=signal.Signals(signum).name)

    for received in (signal.SIGINT, signal.SIGTERM):
        signal.signal(received, stop)

    while running:
        try:
            handled = run_once(config, predictor)
        except Exception as error:  # noqa: BLE001 - 루프는 어떤 예외로도 멈추지 않는다
            log("error", "worker_error", message=f"{type(error).__name__}: {error}"[:300])
            handled = False
        if not handled:
            time.sleep(config.poll_interval_ms / 1000)

    lock.close()
    log("info", "worker_stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
