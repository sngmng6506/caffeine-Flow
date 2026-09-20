import { describe, expect, it, vi } from 'vitest';
import resultModule from '../src/features/audio-analysis/result.js';
import runsModule from '../src/features/audio-analysis/runs.js';
import authModule from '../src/middleware/auth.js';

// 전체 테스트(`vitest run`)는 unit 전용 setup 파일을 읽지 않는다. CommonJS
// config가 import 시점에 환경변수를 캡처하므로 정적 import보다 먼저 설정한다.
vi.hoisted(() => {
  process.env.AUDIO_ANALYSIS_WORKER_TOKEN ||= 'unit-audio-analysis-token';
});

const { validateAudioAnalysisResult } = resultModule;
const { validateRun } = runsModule;
const { requireAudioAnalysisWorker } = authModule;

const validResult = {
  platform: 'youtube',
  track_key: 'abc123',
  model_name: 'essentia-standard',
  model_version: '2.1b6.dev1389',
  feature_schema_version: 1,
  rights_basis: 'licensed',
  source_reference: 'license-ticket-1',
  analyzed_at: '2026-09-07T03:00:00.000Z',
  features: {
    duration_seconds: 180,
    sample_rate: 44100,
    bpm: 92.4,
    beat_confidence: 2.1,
    key: 'C#',
    scale: 'minor',
    key_strength: 0.71,
    danceability: 1.2,
    loudness_db: -12.4,
    dynamic_complexity: 3.2,
    spectral_centroid_hz: 2100,
    energy: 0.08,
    valence: null,
    arousal: null,
  },
  suggested_annotation: {
    tempo_class: 'moderate',
    rhythmic_character: 'steady',
    mood_tags: [],
  },
};

describe('Essentia 분석 결과 검증', () => {
  it('권리 근거·모델 버전·정규화 특징을 저장 형태로 만든다', () => {
    const result = validateAudioAnalysisResult(validResult);
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual(expect.objectContaining({
      platform: 'youtube',
      rights_basis: 'licensed',
      feature_schema_version: 1,
      analyzed_at: expect.any(Date),
      features: expect.objectContaining({ bpm: 92.4, valence: null }),
    }));
  });

  it('권리 근거 없는 결과와 범위를 벗어난 특징을 거절한다', () => {
    expect(validateAudioAnalysisResult({
      ...validResult,
      rights_basis: 'unknown',
    }).error).toBeTruthy();
    expect(validateAudioAnalysisResult({
      ...validResult,
      features: { ...validResult.features, valence: 1.5 },
    }).error).toBeTruthy();
  });

  it('unknown 분위기를 자동 추천값으로 받지 않는다', () => {
    expect(validateAudioAnalysisResult({
      ...validResult,
      suggested_annotation: { ...validResult.suggested_annotation, mood_tags: ['unknown'] },
    }).error).toBeTruthy();
  });
});

describe('신청 시점 분석 실행 검증', () => {
  const result = {
    source_reference: 'https://www.youtube.com/watch?v=abcdefghijk',
    features: { duration_seconds: 120, valence: 0.7, arousal: 0.7 },
  };
  const baseRun = {
    schema_version: 1,
    pipeline_mode: 'EMOTION_LLM',
    sources_used: ['msd-musicnn-1', 'deam-msd-musicnn-2'],
    audio_source_url: result.source_reference,
    audio_local_path: null,
    audio_sha256: 'a'.repeat(64),
    audio_duration_sec: 120,
    audio_sample_rate: 16000,
    audio_llm_raw: null,
    normalized: {
      genre: [],
      mood: {
        valence: 0.7,
        arousal: 0.7,
        source: 'deam-msd-musicnn-2',
        tags: ['joyful', 'uplifting'],
      },
    },
  };

  it('Audio LLM을 건너뛴 부분 성공을 허용한다', () => {
    const checked = validateRun(baseRun, result);
    expect(checked.error).toBeUndefined();
    expect(checked.value.audio_llm_raw).toBeNull();
    expect(checked.value.sources_used).toEqual(baseRun.sources_used);
  });

  it('Audio LLM 결과가 있으면 모델과 입력 해시를 함께 검증한다', () => {
    const audioLlm = {
      model_id: 'google/gemini-2.5-pro',
      prompt_version: 'audio-llm-3',
      input_sha256: baseRun.audio_sha256,
      description: '잔잔한 피아노가 이어진다',
      mood: ['차분함'],
      instruments: ['피아노'],
      vocal: ['보컬 없음'],
      structure: ['중앙부에서 피아노가 이어진다'],
      segments: [{ start_sec: 45, duration_sec: 10 }],
    };
    const checked = validateRun({
      ...baseRun,
      sources_used: [...baseRun.sources_used, audioLlm.model_id],
      audio_llm_raw: audioLlm,
    }, result);
    expect(checked.error).toBeUndefined();

    expect(validateRun({
      ...baseRun,
      sources_used: [...baseRun.sources_used, audioLlm.model_id],
      audio_llm_raw: { ...audioLlm, input_sha256: 'b'.repeat(64) },
    }, result).error).toBeTruthy();
  });
});

describe('오디오 분석 워커 인증', () => {
  it('전용 토큰만 통과시킨다', () => {
    const next = vi.fn();
    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    requireAudioAnalysisWorker(
      { headers: { authorization: 'Bearer unit-audio-analysis-token' } },
      { status, json },
      next,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('잘못된 토큰을 401로 거절한다', () => {
    const next = vi.fn();
    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    requireAudioAnalysisWorker(
      { headers: { authorization: 'Bearer wrong' } },
      { status, json },
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});
