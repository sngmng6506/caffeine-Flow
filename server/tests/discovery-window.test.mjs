// 날짜 소스의 진도. 상대적인 "며칠 전"으로 잡으면 한동안 버튼을 안 누른 사이에
// 나온 곡이 통째로 빠진다.
import { describe, it, expect } from 'vitest';
import pkg from '../src/features/audio-analysis/discovery-window.js';

const { nextWindow, advance, isDateWindowSource } = pkg;
const day = (value) => new Date(`${value}T00:00:00Z`);

describe('수집 날짜 창', () => {
  it('날짜로 진도를 잡는 소스만 구분한다', () => {
    expect(isDateWindowSource('musicbrainz_kr')).toBe(true);
    expect(isDateWindowSource('apple_kr')).toBe(false);
  });

  it('처음에는 최근 7일을 본다', () => {
    expect(nextWindow(null, day('2026-09-10')))
      .toEqual({ from: '2026-09-03', to: '2026-09-10', mode: 'fresh' });
  });

  it('최신을 따라잡았으면 과거로 내려간다', () => {
    const cursor = { covered_from: '2026-09-03', covered_to: '2026-09-10' };

    const next = nextWindow(cursor, day('2026-09-10'));

    expect(next.mode).toBe('backfill');
    expect([next.from, next.to]).toEqual(['2026-08-27', '2026-09-03']);
  });

  it('한동안 누르지 않았으면 빠진 구간을 먼저 메운다', () => {
    // 9/10까지 훑고 한 달 방치한 뒤 다시 누른 경우.
    const cursor = { covered_from: '2026-08-27', covered_to: '2026-09-10' };

    const next = nextWindow(cursor, day('2026-10-10'));

    expect(next.mode).toBe('fresh');
    expect([next.from, next.to]).toEqual(['2026-09-10', '2026-10-10']);
    expect(advance(cursor, next))
      .toEqual({ covered_from: '2026-08-27', covered_to: '2026-10-10' });
  });

  it('백필 하한에 닿으면 더 내려가지 않는다', () => {
    const atFloor = { covered_from: '2025-09-10', covered_to: '2026-09-10' };

    expect(nextWindow(atFloor, day('2026-09-10'))).toBeNull();
  });

  it('하한을 넘지 않도록 마지막 구간을 잘라 맞춘다', () => {
    const nearFloor = { covered_from: '2025-09-14', covered_to: '2026-09-10' };

    const next = nextWindow(nearFloor, day('2026-09-10'));

    expect(next.from).toBe('2025-09-10');
    expect(next.from_is_floor).toBe(true);
  });

  it('하한에 닿은 뒤에도 새로 나온 곡은 계속 메운다', () => {
    const atFloor = { covered_from: '2025-09-10', covered_to: '2026-09-10' };

    const next = nextWindow(atFloor, day('2026-09-20'));

    expect(next.mode).toBe('fresh');
    expect([next.from, next.to]).toEqual(['2026-09-10', '2026-09-20']);
  });

  it('백필은 과거 끝만 늘리고 최신 끝은 지키다', () => {
    const cursor = { covered_from: '2026-09-03', covered_to: '2026-09-10' };
    const back = nextWindow(cursor, day('2026-09-10'));

    expect(advance(cursor, back))
      .toEqual({ covered_from: '2026-08-27', covered_to: '2026-09-10' });
  });
});
