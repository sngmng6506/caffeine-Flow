import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import worker
from worker import WorkerConfig, acquire_lock, ensure_queue_dirs, finish, next_job_dir, run_once

MANIFEST = {
    "platform": "youtube",
    "track_key": "track-1",
    "audio_filename": "audio.ogg",
}

FEATURES = {
    "duration_seconds": 120.0,
    "sample_rate": 44100,
    "bpm": 96.0,
    "danceability": 1.2,
    "valence": 0.42,
    "arousal": 0.31,
}


def make_config(root, **env):
    base = {
        "CAFFEINE_FLOW_SERVER_URL": "https://example.invalid",
        "AUDIO_ANALYSIS_WORKER_TOKEN": "test-token-not-real",
        "AUDIO_WORKER_ROOT": str(root),
    }
    return WorkerConfig({**base, **env})


def seed_job(root, job_id="job-1", manifest=None):
    job_dir = root / "inbox" / job_id
    job_dir.mkdir(parents=True)
    (job_dir / "manifest.json").write_text(
        json.dumps(manifest if manifest is not None else MANIFEST), encoding="utf-8"
    )
    (job_dir / "audio.ogg").write_bytes(b"x" * 64)
    return job_dir


def run_quietly(config, predictor=None):
    """워커 로그는 journald용 JSON이라 테스트 출력에서 걷어낸다."""
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        handled = run_once(config, predictor)
    return handled, buffer.getvalue()


class QueueLayoutTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        ensure_queue_dirs(self.root)

    def test_creates_every_queue_directory(self):
        for name in ("inbox", "processing", "processed", "failed"):
            self.assertTrue((self.root / name).is_dir())

    def test_picks_the_oldest_job_and_ignores_files(self):
        (self.root / "inbox" / "stray.txt").write_text("x", encoding="utf-8")
        (self.root / "inbox" / ".hidden").mkdir()
        first = seed_job(self.root, "job-a")
        import os

        os.utime(first, (1_000_000, 1_000_000))
        seed_job(self.root, "job-b")

        self.assertEqual(next_job_dir(self.root), first)

    def test_empty_inbox_has_no_job(self):
        self.assertIsNone(next_job_dir(self.root))

    def test_finish_keeps_both_runs_when_names_collide(self):
        (self.root / "processed" / "job-1").mkdir(parents=True)
        claimed = self.root / "processing" / "job-1"
        claimed.mkdir(parents=True)

        moved = finish(claimed, self.root, "processed")

        self.assertNotEqual(moved.name, "job-1")
        self.assertTrue((self.root / "processed" / "job-1").is_dir())


class LockTest(unittest.TestCase):
    def test_second_worker_refuses_to_start(self):
        with tempfile.TemporaryDirectory() as name:
            root = ensure_queue_dirs(Path(name))
            first = acquire_lock(root)
            self.addCleanup(first.close)

            with self.assertRaisesRegex(RuntimeError, "이미 실행 중"):
                acquire_lock(root)


class RunOnceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        ensure_queue_dirs(self.root)
        self.config = make_config(self.root)

    def test_no_job_means_no_work(self):
        handled, _ = run_quietly(self.config)

        self.assertFalse(handled)

    def test_successful_job_moves_to_processed_and_submits(self):
        seed_job(self.root)
        submitted = []

        with patch.object(worker, "analyze_audio", return_value=(FEATURES, "2.1-beta6", {})), \
             patch.object(worker, "submit", side_effect=lambda url, token, payload: submitted.append(payload) or {"id": 7}):
            handled, logs = run_quietly(self.config)

        self.assertTrue(handled)
        self.assertTrue((self.root / "processed" / "job-1" / "result.json").is_file())
        self.assertFalse((self.root / "inbox" / "job-1").exists())
        self.assertFalse(any((self.root / "processing").iterdir()))
        self.assertEqual(submitted[0]["track_key"], "track-1")
        self.assertEqual(submitted[0]["features"]["valence"], 0.42)
        self.assertIn("job_succeeded", logs)

    def test_analysis_failure_moves_to_failed_with_a_reason(self):
        seed_job(self.root)

        with patch.object(worker, "analyze_audio", side_effect=ValueError("음원이 너무 짧습니다")):
            handled, logs = run_quietly(self.config)

        self.assertTrue(handled)
        failed = self.root / "failed" / "job-1"
        self.assertTrue(failed.is_dir())
        self.assertIn("음원이 너무 짧습니다", (failed / "error.txt").read_text(encoding="utf-8"))
        self.assertIn("job_failed", logs)

    def test_invalid_manifest_fails_without_analysis(self):
        seed_job(self.root, manifest={**MANIFEST, "audio_filename": "../escape.ogg"})
        calls = []

        with patch.object(worker, "analyze_audio", side_effect=lambda *a, **k: calls.append(a)):
            run_quietly(self.config)

        self.assertEqual(calls, [], "manifest 검증 전에 분석을 시작하면 안 된다")
        self.assertTrue((self.root / "failed" / "job-1").is_dir())

    def test_network_failure_can_be_reprocessed_after_moving_back(self):
        seed_job(self.root)

        with patch.object(worker, "analyze_audio", return_value=(FEATURES, "2.1-beta6", {})), \
             patch.object(worker, "submit", side_effect=RuntimeError("분석 결과 서버에 연결할 수 없습니다")):
            run_quietly(self.config)

        failed = self.root / "failed" / "job-1"
        self.assertTrue(failed.is_dir())

        # 운영자가 실패한 작업을 inbox로 되돌리면 그대로 다시 처리된다.
        failed.rename(self.root / "inbox" / "job-1")
        with patch.object(worker, "analyze_audio", return_value=(FEATURES, "2.1-beta6", {})), \
             patch.object(worker, "submit", return_value={"id": 7}):
            handled, _ = run_quietly(self.config)

        self.assertTrue(handled)
        self.assertTrue((self.root / "processed" / "job-1" / "result.json").is_file())

    def test_failure_sends_one_discord_alert(self):
        seed_job(self.root)
        config = make_config(self.root, DISCORD_AUDIO_WEBHOOK_URL="https://discord.invalid/hook")
        alerts = []

        with patch.object(worker, "analyze_audio", side_effect=ValueError("boom")), \
             patch.object(worker, "notify_discord", side_effect=lambda *args: alerts.append(args)):
            run_quietly(config)

        self.assertEqual(len(alerts), 1)

    def test_dry_run_does_not_submit(self):
        seed_job(self.root)
        config = make_config(self.root, AUDIO_WORKER_DRY_RUN="true")

        with patch.object(worker, "analyze_audio", return_value=(FEATURES, "2.1-beta6", {})), \
             patch.object(worker, "submit", side_effect=AssertionError("dry-run은 제출하지 않는다")):
            handled, _ = run_quietly(config)

        self.assertTrue(handled)
        self.assertTrue((self.root / "processed" / "job-1").is_dir())


class ConfigTest(unittest.TestCase):
    def test_valence_arousal_is_off_unless_explicitly_enabled(self):
        with tempfile.TemporaryDirectory() as name:
            self.assertFalse(make_config(Path(name)).enable_valence_arousal)
            enabled = make_config(Path(name), ENABLE_VALENCE_AROUSAL="true")
            self.assertTrue(enabled.enable_valence_arousal)
            self.assertFalse(
                make_config(Path(name), ENABLE_VALENCE_AROUSAL="1").enable_valence_arousal,
                "true 외의 값으로 비상업 모델이 켜지면 안 된다",
            )

    def test_missing_server_url_or_token_stops_the_worker(self):
        with tempfile.TemporaryDirectory() as name:
            with self.assertRaisesRegex(ValueError, "CAFFEINE_FLOW_SERVER_URL"):
                make_config(Path(name), CAFFEINE_FLOW_SERVER_URL="").require()
            with self.assertRaisesRegex(ValueError, "AUDIO_ANALYSIS_WORKER_TOKEN"):
                make_config(Path(name), AUDIO_ANALYSIS_WORKER_TOKEN="").require()

    def test_poll_interval_falls_back_on_nonsense(self):
        with tempfile.TemporaryDirectory() as name:
            self.assertEqual(make_config(Path(name), POLL_INTERVAL_MS="abc").poll_interval_ms, 5000)
            self.assertEqual(make_config(Path(name), POLL_INTERVAL_MS="-1").poll_interval_ms, 5000)
            self.assertEqual(make_config(Path(name), POLL_INTERVAL_MS="250").poll_interval_ms, 250)


if __name__ == "__main__":
    unittest.main()
