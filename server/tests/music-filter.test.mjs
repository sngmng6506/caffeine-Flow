import { describe, it, expect } from 'vitest';
import { normalizeLlmDecision, rejectionFromError } from '../src/features/music-filter/decision.policy.js';
import { FILTER_ACTION, FILTER_STATUS } from '../src/constants/music-filter-status.js';
import {
  DEFAULT_MUSIC_FILTER_STRICTNESS,
  MUSIC_FILTER_STRICTNESS,
  MUSIC_FILTER_STRICTNESS_GUIDES,
  VALID_MUSIC_FILTER_STRICTNESS,
} from '../src/constants/music-filter-policy.js';

describe('AI 음악 필터 상태 계약', () => {
  it('LLM accept는 action=accept, filter_status=accepted로 정규화한다', () => {
    const result = normalizeLlmDecision({ decision: 'accept', confidence: 0.8, reason: '분위기에 맞습니다.' });
    expect(result.action).toBe(FILTER_ACTION.ACCEPT);
    expect(result.filterStatus).toBe(FILTER_STATUS.ACCEPTED);
    expect(result.confidence).toBe(0.8);
  });

  it('LLM reject는 action=reject, filter_status=rejected로 정규화한다', () => {
    const result = normalizeLlmDecision({ decision: 'reject', confidence: 0.7, reason: '매장 분위기와 맞지 않습니다.' });
    expect(result.action).toBe(FILTER_ACTION.REJECT);
    expect(result.filterStatus).toBe(FILTER_STATUS.REJECTED);
  });

  it('중간 판단값은 허용하지 않는다', () => {
    expect(() => normalizeLlmDecision({ decision: 'review', confidence: 0.5 })).toThrow();
    expect(() => normalizeLlmDecision({ decision: 'pending', confidence: 0.5 })).toThrow();
  });

  it('LLM 실패는 항상 fail-closed error_rejected로 변환한다', () => {
    const err = Object.assign(new Error('timeout'), { code: 'LLM_TIMEOUT' });
    const result = rejectionFromError(err);
    expect(result.action).toBe(FILTER_ACTION.REJECT);
    expect(result.filterStatus).toBe(FILTER_STATUS.ERROR_REJECTED);
    expect(result.errorCode).toBe('LLM_TIMEOUT');
  });
});

describe('AI 음악 필터 강도 계약', () => {
  it('허용 strictness는 low/medium/high이고 기본값은 medium이다', () => {
    expect(VALID_MUSIC_FILTER_STRICTNESS).toEqual([
      MUSIC_FILTER_STRICTNESS.LOW,
      MUSIC_FILTER_STRICTNESS.MEDIUM,
      MUSIC_FILTER_STRICTNESS.HIGH,
    ]);
    expect(DEFAULT_MUSIC_FILTER_STRICTNESS).toBe(MUSIC_FILTER_STRICTNESS.MEDIUM);
  });

  it('각 strictness는 프롬프트 가이드를 가진다', () => {
    for (const strictness of VALID_MUSIC_FILTER_STRICTNESS) {
      expect(MUSIC_FILTER_STRICTNESS_GUIDES[strictness]).toBeTruthy();
    }
  });
});
