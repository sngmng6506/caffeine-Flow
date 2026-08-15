import { describe, expect, it } from 'vitest';
import policyModule from '../src/services/playback-history-policy.js';

const { shouldStorePlayback } = policyModule;

describe('사장님 직접 재생 이력 저장 정책', () => {
  it('정상 종료는 1분 미만이어도 저장한다', () => {
    expect(shouldStorePlayback({ durationSeconds: 10, endReason: 'ended' })).toBe(true);
  });

  it('곡 변경은 1분 이상 재생했을 때만 저장한다', () => {
    expect(shouldStorePlayback({ durationSeconds: 59, endReason: 'changed' })).toBe(false);
    expect(shouldStorePlayback({ durationSeconds: 60, endReason: 'changed' })).toBe(true);
  });
});
