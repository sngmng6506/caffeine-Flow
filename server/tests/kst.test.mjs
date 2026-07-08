import { describe, it, expect } from 'vitest';
import { kstStartOfDateString, kstEndOfDateString, getKstHour } from '../src/utils/kst.js';

describe('kst 경계', () => {
  it('KST 자정은 UTC 전날 15:00', () => {
    expect(kstStartOfDateString('2026-07-06').toISOString()).toBe('2026-07-05T15:00:00.000Z');
    expect(kstEndOfDateString('2026-07-06').toISOString()).toBe('2026-07-06T14:59:59.999Z');
  });
  it('getKstHour — UTC 15시는 KST 0시, UTC 23시는 KST 8시', () => {
    expect(getKstHour(new Date('2026-07-05T15:00:00Z'))).toBe(0);
    expect(getKstHour(new Date('2026-07-05T23:00:00Z'))).toBe(8);
  });
});
