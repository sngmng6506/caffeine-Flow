// 알림 집계·쓰로틀 로직 검사.
//
// 이 로직의 존재 이유는 "에러를 알린다"가 아니라 "알림이 소음이 되지 않게
// 한다"이므로, 테스트도 보내는 경우보다 보내지 않는 경우를 더 촘촘히 본다.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAlertAggregator } = require('../src/observability/alert-aggregator');
const { CAUSE, ALERT_TIER, DEFAULT_THRESHOLD, CODE_THRESHOLDS, thresholdFor } = require('../src/observability/error-taxonomy');

function fixedClock(start = 1_000_000) {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; } };
}

const cafeA = { cafeId: 'cafe-a', slug: 'alpha' };
const cafeB = { cafeId: 'cafe-b', slug: 'bravo' };

describe('알림 집계', () => {
  it('손님 입력 탓 에러는 아무리 쌓여도 알리지 않는다', () => {
    const clock = fixedClock();
    const agg = createAlertAggregator({ now: clock.now });
    for (let i = 0; i < 50; i += 1) {
      const summary = agg.record({ code: 'TRACK_METADATA_FAILED', cause: CAUSE.USER, ...cafeA });
      expect(summary).toBeNull();
    }
  });

  it('즉시 알림 코드는 1건에 바로 나간다', () => {
    const clock = fixedClock();
    const agg = createAlertAggregator({ now: clock.now });
    const summary = agg.record({ code: 'LLM_API_KEY_MISSING', cause: CAUSE.EXTERNAL, ...cafeA });
    expect(summary).not.toBeNull();
    expect(summary.tier).toBe(ALERT_TIER.IMMEDIATE);
    expect(summary.count).toBe(1);
  });

  it('임계값에 도달해야 나간다', () => {
    const clock = fixedClock();
    const agg = createAlertAggregator({ now: clock.now, threshold: () => 3 });
    for (let i = 0; i < 2; i += 1) {
      expect(agg.record({ code: 'LLM_TIMEOUT', cause: CAUSE.EXTERNAL, ...cafeA })).toBeNull();
    }
    const summary = agg.record({ code: 'LLM_TIMEOUT', cause: CAUSE.EXTERNAL, ...cafeA });
    expect(summary).not.toBeNull();
    expect(summary.count).toBe(3);
  });

  it('현재 정책은 종류별 첫 발생을 바로 알린다', () => {
    // 신청량이 많지 않아 높은 임계값은 곧 "영영 안 울림"이 된다.
    // 소음은 임계값이 아니라 쿨다운으로 막는 것이 현재 선택이다.
    expect(DEFAULT_THRESHOLD).toBe(1);
    const clock = fixedClock();
    const agg = createAlertAggregator({ now: clock.now });
    expect(agg.record({ code: 'LLM_TIMEOUT', cause: CAUSE.EXTERNAL, ...cafeA })).not.toBeNull();
  });

  it('코드별 임계값 예외를 두면 그 값을 따른다', () => {
    // 지금은 비어 있다. 예외를 추가하면 이 테스트가 자동으로 검증한다.
    for (const [code, expected] of Object.entries(CODE_THRESHOLDS)) {
      expect(thresholdFor(code)).toBe(expected);
    }
    expect(thresholdFor('예외에-없는-코드')).toBe(DEFAULT_THRESHOLD);
  });

  it('창 밖으로 나간 이벤트는 임계값 계산에서 빠진다', () => {
    const clock = fixedClock();
    const windowMs = 5 * 60 * 1000;
    const agg = createAlertAggregator({ windowMs, now: clock.now, threshold: () => 3 });
    for (let i = 0; i < 2; i += 1) {
      agg.record({ code: 'LLM_TIMEOUT', cause: CAUSE.EXTERNAL, ...cafeA });
    }
    clock.advance(windowMs + 1);
    // 창이 지나 앞의 이벤트가 사라졌으므로 이번 1건으로는 부족하다
    expect(agg.record({ code: 'LLM_TIMEOUT', cause: CAUSE.EXTERNAL, ...cafeA })).toBeNull();
    expect(agg.pendingCount('LLM_TIMEOUT')).toBe(1);
  });

  it('쿨다운 동안에는 같은 코드를 다시 알리지 않는다', () => {
    const clock = fixedClock();
    const cooldownMs = 60 * 60 * 1000;
    const agg = createAlertAggregator({ cooldownMs, now: clock.now });
    expect(agg.record({ code: 'DB_CONNECTION_FAILED', cause: CAUSE.PLATFORM })).not.toBeNull();
    for (let i = 0; i < 100; i += 1) {
      expect(agg.record({ code: 'DB_CONNECTION_FAILED', cause: CAUSE.PLATFORM })).toBeNull();
    }
    clock.advance(cooldownMs + 1);
    expect(agg.record({ code: 'DB_CONNECTION_FAILED', cause: CAUSE.PLATFORM })).not.toBeNull();
  });

  it('쿨다운 중에도 계속 집계해 해제 직후 상태를 반영한다', () => {
    const clock = fixedClock();
    const agg = createAlertAggregator({ now: clock.now });
    agg.record({ code: 'LLM_API_KEY_MISSING', cause: CAUSE.EXTERNAL, ...cafeA });
    clock.advance(60_000);
    agg.record({ code: 'LLM_API_KEY_MISSING', cause: CAUSE.EXTERNAL, ...cafeB });
    expect(agg.pendingCount('LLM_API_KEY_MISSING')).toBe(1);
  });

  it('영향받은 카페 수로 매장 문제와 플랫폼 사고를 구분한다', () => {
    const clock = fixedClock();
    const agg = createAlertAggregator({ now: clock.now, threshold: () => 5 });
    agg.record({ code: 'LLM_TIMEOUT', cause: CAUSE.EXTERNAL, ...cafeA });
    agg.record({ code: 'LLM_TIMEOUT', cause: CAUSE.EXTERNAL, ...cafeA });
    agg.record({ code: 'LLM_TIMEOUT', cause: CAUSE.EXTERNAL, ...cafeB });
    agg.record({ code: 'LLM_TIMEOUT', cause: CAUSE.EXTERNAL, ...cafeB });
    const summary = agg.record({ code: 'LLM_TIMEOUT', cause: CAUSE.EXTERNAL, ...cafeB });
    expect(summary.count).toBe(5);
    expect(summary.affectedCafeCount).toBe(2);
    expect(summary.cafes.map((c) => c.slug).sort()).toEqual(['alpha', 'bravo']);
  });

  it('카페가 많으면 목록을 자르고 남은 수를 센다', () => {
    const clock = fixedClock();
    // 임계값에 도달하는 순간 발사하고 창을 비우므로, 목록 상한(5)을 넘는
    // 카페를 한 창에 모으려면 임계값을 더 높게 주입해야 한다.
    const threshold = 10;
    const agg = createAlertAggregator({ now: clock.now, threshold: () => threshold });
    let summary = null;
    for (let i = 0; i < threshold; i += 1) {
      summary = agg.record({ code: 'INTERNAL_ERROR', cause: CAUSE.PLATFORM, cafeId: `cafe-${i}`, slug: `s${i}` })
        || summary;
    }
    expect(summary.affectedCafeCount).toBe(threshold);
    expect(summary.cafes).toHaveLength(5);
    expect(summary.hiddenCafeCount).toBe(threshold - 5);
  });

  it('알림을 보낸 뒤에는 창을 비워 같은 건을 두 번 세지 않는다', () => {
    const clock = fixedClock();
    const agg = createAlertAggregator({ cooldownMs: 0, now: clock.now, threshold: () => 5 });
    for (let i = 0; i < 5; i += 1) {
      agg.record({ code: 'LLM_TIMEOUT', cause: CAUSE.EXTERNAL, ...cafeA });
    }
    expect(agg.pendingCount('LLM_TIMEOUT')).toBe(0);
  });
});
