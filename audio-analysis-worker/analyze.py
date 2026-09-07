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

from suggestions import build_suggestions


SAMPLE_RATE = 44100
FEATURE_SCHEMA_VERSION = 1


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


def analyze_audio(path):
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
        # 감정값은 별도 상업 이용 가능한 회귀 모델을 연결할 때 채운다.
        "valence": None,
        "arousal": None,
    }
    return features, getattr(essentia, "__version__", "unknown")


def build_payload(args, features, model_version):
    return {
        "platform": args.platform,
        "track_key": args.track_key,
        "model_name": "essentia-standard",
        "model_version": model_version,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "rights_basis": args.rights_basis,
        "source_reference": args.source_reference,
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
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    audio_path = args.audio_file.expanduser().resolve()
    if not audio_path.is_file():
        raise FileNotFoundError(f"음원 파일을 찾을 수 없습니다: {audio_path}")
    if not args.dry_run and not args.token:
        raise ValueError("--token 또는 AUDIO_ANALYSIS_WORKER_TOKEN이 필요합니다.")

    features, model_version = analyze_audio(audio_path)
    payload = build_payload(args, features, model_version)
    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    saved = submit(args.server_url, args.token, payload)
    print(json.dumps(saved, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
