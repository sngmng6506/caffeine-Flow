import { describe, expect, it, vi } from 'vitest';
import resultModule from '../src/features/audio-analysis/result.js';
import authModule from '../src/middleware/auth.js';

// 전체 테스트(`vitest run`)는 unit 전용 setup 파일을 읽지 않는다. CommonJS
// config가 import 시점에 환경변수를 캡처하므로 정적 import보다 먼저 설정한다.
vi.hoisted(() => {
  process.env.AUDIO_ANALYSIS_WORKER_TOKEN ||= 'unit-audio-analysis-token';
});

const { validateAudioAnalysisResult } = resultModule;
const { requireAudioAnalysisWorker } = authModule;

const validResult = {
  platform: 'youtube',
  track_key: 'abc123',
  model_name: 'essentia-standard',
  model_version: '2.1b6.dev1389',
  feature_schema_version: 1,
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

const fullSuggestion = {
  tempo_class: 'moderate',
  rhythmic_character: 'steady',
  mood_tags: ['peaceful'],
  instrumentation_type: 'acoustic',
  vocal_type: 'singing',
  genre_tags: ['jazz'],
  confidence: { mood_tags: 0.91, vocal_type: 0.66, genre_tags: 0.86 },
  min_confidence: 0.66,
  review_flags: ['low_confidence:vocal_type', 'missing:instrumentation_type'],
};

describe('Essentia 분석 결과 검증', () => {
  it('모델 버전과 정규화 특징을 저장 형태로 만든다', () => {
    const result = validateAudioAnalysisResult(validResult);
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual(expect.objectContaining({
      platform: 'youtube',
      feature_schema_version: 1,
      analyzed_at: expect.any(Date),
      features: expect.objectContaining({ bpm: 92.4, valence: null }),
    }));
  });

  it('예전 워커가 보내는 권리 필드는 받아들이되 저장 형태에 담지 않는다', () => {
    const result = validateAudioAnalysisResult({
      ...validResult,
      rights_basis: 'licensed',
      source_reference: 'license-ticket-1',
    });

    expect(result.error).toBeUndefined();
    expect(result.value).not.toHaveProperty('rights_basis');
    expect(result.value).not.toHaveProperty('source_reference');
  });

  it('범위를 벗어난 특징을 거절한다', () => {
    expect(validateAudioAnalysisResult({
      ...validResult,
      features: { ...validResult.features, valence: 1.5 },
    }).error).toBeTruthy();
  });

  it('분류 헤드가 채운 모든 칸과 신뢰도를 그대로 보존한다', () => {
    const result = validateAudioAnalysisResult({
      ...validResult,
      suggested_annotation: fullSuggestion,
    });

    expect(result.error).toBeUndefined();
    expect(result.value.suggested_annotation).toEqual(fullSuggestion);
  });

  it('확률이 없는 휴리스틱 칸에는 신뢰도를 받지 않는다', () => {
    // 템포는 BPM 구간이라 확률이 없다. 점수가 붙으면 애매한 순 정렬이 거짓말을 한다.
    expect(validateAudioAnalysisResult({
      ...validResult,
      suggested_annotation: { ...fullSuggestion, confidence: { tempo_class: 0.9 } },
    }).error).toBeTruthy();
  });

  it('정해지지 않은 검수 신호와 범위를 벗어난 신뢰도를 거절한다', () => {
    expect(validateAudioAnalysisResult({
      ...validResult,
      suggested_annotation: { ...fullSuggestion, review_flags: ['소리가 이상함'] },
    }).error).toBeTruthy();
    expect(validateAudioAnalysisResult({
      ...validResult,
      suggested_annotation: { ...fullSuggestion, confidence: { mood_tags: 1.4 } },
    }).error).toBeTruthy();
    expect(validateAudioAnalysisResult({
      ...validResult,
      suggested_annotation: { ...fullSuggestion, min_confidence: -0.1 },
    }).error).toBeTruthy();
  });

  it('장르 추천은 2개까지만 받고 unknown을 받지 않는다', () => {
    expect(validateAudioAnalysisResult({
      ...validResult,
      suggested_annotation: { ...fullSuggestion, genre_tags: ['jazz', 'pop', 'rock_metal'] },
    }).error).toBeTruthy();
    expect(validateAudioAnalysisResult({
      ...validResult,
      suggested_annotation: { ...fullSuggestion, genre_tags: ['unknown'] },
    }).error).toBeTruthy();
  });

  it('unknown 분위기를 자동 추천값으로 받지 않는다', () => {
    expect(validateAudioAnalysisResult({
      ...validResult,
      suggested_annotation: { ...validResult.suggested_annotation, mood_tags: ['unknown'] },
    }).error).toBeTruthy();
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
