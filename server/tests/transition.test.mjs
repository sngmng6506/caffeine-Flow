import { describe, it, expect } from 'vitest';
import { isValidTransition, TERMINAL_STATUSES } from '../src/services/recommendation.service.js';
import { OWNER_MUTABLE_STATUSES } from '../src/constants/recommendation-status.js';

describe('추천곡 상태 전이', () => {
  it('활성 상태 간 양방향 전이 허용 (드래그 UI)', () => {
    expect(isValidTransition('pending', 'accepted')).toBe(true);
    expect(isValidTransition('accepted', 'pending')).toBe(true);
    expect(isValidTransition('playing', 'accepted')).toBe(true);
    expect(isValidTransition('accepted', 'playing')).toBe(true);
  });
  it('활성 → 종료 허용', () => {
    expect(isValidTransition('playing', 'played')).toBe(true);
    expect(isValidTransition('playing', 'skipped')).toBe(true);
    expect(isValidTransition('pending', 'rejected')).toBe(true);
  });
  it('종료 상태에서의 모든 전이 차단', () => {
    for (const from of TERMINAL_STATUSES) {
      expect(isValidTransition(from, 'accepted')).toBe(false);
      expect(isValidTransition(from, 'playing')).toBe(false);
    }
  });
  it('동일 상태 재설정은 허용 (멱등)', () => {
    expect(isValidTransition('played', 'played')).toBe(true);
  });

  it('사장님 API는 accepted → pending 복귀를 허용한다', () => {
    expect(OWNER_MUTABLE_STATUSES).toContain('pending');
  });
});
