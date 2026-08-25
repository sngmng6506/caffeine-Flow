import { describe, it, expect } from 'vitest';
import { normalizeLlmDecision, rejectionFromError } from '../src/features/music-filter/decision.policy.js';
import { buildMusicFilterMessages, resolveCafePrompt } from '../src/features/music-filter/prompt.builder.js';
import { FILTER_ACTION, FILTER_STATUS } from '../src/constants/music-filter-status.js';
import {
  HUMAN_DECISION,
  HUMAN_DECISIONS,
  HUMAN_REASON_CODE,
  HUMAN_REASON_CODES,
} from '../src/constants/music-filter-review.js';

describe('AI 음악 필터 상태 계약', () => {
  it('사람 검수 라벨은 고정된 정답과 사유 코드만 사용한다', () => {
    expect(HUMAN_DECISIONS).toEqual([
      HUMAN_DECISION.ACCEPT,
      HUMAN_DECISION.REJECT,
      HUMAN_DECISION.UNDETERMINED,
    ]);
    expect(HUMAN_REASON_CODES).toEqual([
      HUMAN_REASON_CODE.POLICY_MATCH,
      HUMAN_REASON_CODE.POLICY_MISMATCH,
      HUMAN_REASON_CODE.UNSAFE_CONTENT,
      HUMAN_REASON_CODE.METADATA_INSUFFICIENT,
      HUMAN_REASON_CODE.OTHER,
    ]);
  });

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

describe('AI 음악 필터 프롬프트 계약', () => {
  it('판단 메시지와 감사 스냅샷에 동일한 정규화 프롬프트를 사용한다', () => {
    expect(resolveCafePrompt('  재즈만 허용합니다.  ')).toBe('재즈만 허용합니다.');
    expect(resolveCafePrompt(null)).toBe('이 매장의 분위기를 해치지 않는 곡만 허용합니다.');
  });

  it('사장님 정책을 유일한 매장 판단 기준으로 전달하고 필터 강도를 추가하지 않는다', () => {
    const messages = buildMusicFilterMessages({
      cafePrompt: '재즈와 로파이만 허용합니다.',
      track: {
        platform: 'youtube',
        title: '테스트 곡',
        channelTitle: '테스트 채널',
      },
    });
    const userMessage = messages.find(message => message.role === 'user').content;

    expect(userMessage).toContain('[사장님이 설정한 매장 분위기]\n재즈와 로파이만 허용합니다.');
    expect(userMessage).not.toContain('필터 강도');
    expect(userMessage).not.toContain('느슨하게');
    expect(userMessage).not.toContain('엄격하게');
  });
});
