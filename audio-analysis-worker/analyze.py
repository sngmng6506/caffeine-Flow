#!/usr/bin/env python3
"""권리가 확인된 로컬 음원을 Essentia로 분석해 Caffeine Flow에 제출한다."""

import argparse
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np

from emotion import (
    EMOTION_MODEL_NAME,
    EMOTION_SAMPLE_RATE,
    estimate_valence_arousal,
    load_emotion_predictor,
)
from suggestions import build_suggestions


SAMPLE_RATE = 44100
FEATURE_SCHEMA_VERSION = 1
MODEL_NAME = "essentia-standard"
DEFAULT_MODEL_DIR = "~/caffeine-audio/models"


def finite_or_none(value):
    number = float(value)
    return number if math.isfinite(number) else None


def mean_spectral_centroid(audio, sample_rate, standard):
    window = standard.Windowing(type="hann")
    spectrum = standard.Spectrum()
    centroid = standard.Centroid(range=sample_rate / 2)
    values = [
        float(centroid(spectrum(window(frame))))
        for frame in standard.FrameGenerator(
            audio,
            frameSize=2048,
            hopSize=1024,
            startFromZero=True,
        )
    ]
    return float(np.mean(values)) if values else None


def analyze_audio(path, emotion_predictor=None):
    try:
        import essentia
        import essentia.standard as standard
    except ImportError as error:
        raise RuntimeError(
            "Essentia가 설치되지 않았습니다. "
            "python -m pip install -r requirements.txt를 실행하세요."
        ) from error

    audio = standard.MonoLoader(filename=str(path), sampleRate=SAMPLE_RATE)()
    duration = len(audio) / SAMPLE_RATE
    if duration < 10:
        raise ValueError("분석 음원은 10초 이상이어야 합니다.")

    bpm, _beats, beat_confidence, _estimates, _intervals = standard.RhythmExtractor2013(
        method="multifeature"
    )(audio)
    key, scale, key_strength = standard.KeyExtractor(profileType="edma")(audio)
    danceability, _dfa = standard.Danceability()(audio)
    dynamic_complexity, loudness = standard.DynamicComplexity()(audio)

    features = {
        "duration_seconds": finite_or_none(duration),
        "sample_rate": SAMPLE_RATE,
        "bpm": finite_or_none(bpm),
        "beat_confidence": finite_or_none(beat_confidence),
        "key": str(key) or None,
        "scale": str(scale).lower() if scale else None,
        "key_strength": finite_or_none(key_strength),
        "danceability": finite_or_none(danceability),
        "loudness_db": finite_or_none(loudness),
        "dynamic_complexity": finite_or_none(dynamic_complexity),
        "spectral_centroid_hz": finite_or_none(
            mean_spectral_centroid(audio, SAMPLE_RATE, standard)
        ),
        "energy": finite_or_none(float(np.mean(np.square(audio)))),
        # 감정값은 별도 라이선스의 회귀 모델을 명시적으로 켰을 때만 채운다.
        "valence": None,
        "arousal": None,
    }

    model_version = getattr(essentia, "__version__", "unknown")
    if emotion_predictor is not None:
        # 모델 카드가 16kHz를 요구한다. 44.1kHz 배열을 재사용하면 조용히 틀린다.
        audio_16k = standard.MonoLoader(
            filename=str(path), sampleRate=EMOTION_SAMPLE_RATE
        )()
        emotion = estimate_valence_arousal(audio_16k, emotion_predictor)
        if emotion:
            features["valence"] = emotion["valence"]
            features["arousal"] = emotion["arousal"]
            # 같은 곡의 VA 있는 결과와 없는 결과가 서로를 덮지 않도록 버전을 나눈다.
            # 서버 upsert 키가 (platform, track_key, model_name, model_version)이다.
            model_version = f"{model_version}+{EMOTION_MODEL_NAME}"
    return features, model_version


def build_payload(manifest, features, model_version):
    """manifest(dict 또는 argparse 네임스페이스)와 특징값으로 제출 payload를 만든다."""
    read = manifest.get if isinstance(manifest, dict) else lambda key: getattr(manifest, key)
    return {
        "platform": read("platform"),
        "track_key": read("track_key"),
        "model_name": MODEL_NAME,
        "model_version": model_version,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "rights_basis": read("rights_basis"),
        "source_reference": read("source_reference"),
        "features": features,
        "suggested_annotation": build_suggestions(features),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }


def submit(server_url, token, payload):
    request = Request(
        f"{server_url.rstrip('/')}/api/v1/audio-analysis/results",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"서버가 분석 결과를 거절했습니다: HTTP {error.code} {body}") from error
    except URLError as error:
        raise RuntimeError(f"분석 결과 서버에 연결할 수 없습니다: {error.reason}") from error


def env_flag(name):
    return os.environ.get(name, "").strip().lower() == "true"


def resolve_emotion_predictor(enabled, model_dir):
    """켜져 있을 때만 예측기를 만든다. 기본값이 꺼짐인 것이 라이선스 계약이다."""
    return load_emotion_predictor(model_dir) if enabled else None


def parse_args():
    parser = argparse.ArgumentParser(
        description="권리가 확인된 로컬 음원을 분석하고 특징값만 서버에 저장합니다."
    )
    parser.add_argument("audio_file", type=Path)
    parser.add_argument("--platform", required=True, choices=["youtube", "soundcloud", "spotify"])
    parser.add_argument("--track-key", required=True)
    parser.add_argument(
        "--rights-basis",
        required=True,
        choices=["owned", "licensed", "public_domain", "other_authorized"],
    )
    parser.add_argument("--source-reference", required=True)
    parser.add_argument(
        "--server-url",
        default=os.environ.get("CAFFEINE_FLOW_SERVER_URL", "http://localhost:3000"),
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("AUDIO_ANALYSIS_WORKER_TOKEN", ""),
    )
    parser.add_argument(
        "--enable-valence-arousal",
        action="store_true",
        default=env_flag("ENABLE_VALENCE_AROUSAL"),
        help="비상업 라이선스 모델로 Valence/Arousal을 추정한다(기본 꺼짐).",
    )
    parser.add_argument(
        "--model-dir",
        default=os.environ.get("AUDIO_MODEL_DIR", DEFAULT_MODEL_DIR),
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    audio_path = args.audio_file.expanduser().resolve()
    if not audio_path.is_file():
        raise FileNotFoundError(f"음원 파일을 찾을 수 없습니다: {audio_path}")
    if not args.dry_run and not args.token:
        raise ValueError("--token 또는 AUDIO_ANALYSIS_WORKER_TOKEN이 필요합니다.")

    predictor = resolve_emotion_predictor(args.enable_valence_arousal, args.model_dir)
    features, model_version = analyze_audio(audio_path, predictor)
    payload = build_payload(args, features, model_version)
    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    saved = submit(args.server_url, args.token, payload)
    print(json.dumps(saved, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
