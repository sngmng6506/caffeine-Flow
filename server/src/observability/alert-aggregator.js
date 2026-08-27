const {
  ALERT_TIER,
  ALERT_WINDOW_MS,
  ALERT_COOLDOWN_MS,
  alertTierFor,
  thresholdFor,
} = require('./error-taxonomy');

// 알림 본문에 나열할 카페 수 상한. 전 카페 장애면 목록이 무한정 길어진다.
const MAX_LISTED_CAFES = 5;

/**
 * 에러 발생을 코드 단위로 모아 "지금 알릴지"를 판단하는 순수 로직.
 *
 * 집계 키를 (code, cafeId)가 아니라 code로 잡고 영향받은 카페를 함께 세는
 * 이유는, 멀티테넌트에서 그 둘이 서로 다른 사건이기 때문이다.
 *   - 한 카페에서만 반복 → 그 매장 설정 문제
 *   - 여러 카페에서 동시 → 플랫폼 전체 사고
 * (code, cafeId)로 쪼개면 후자가 카페 수만큼의 개별 알림으로 흩어져
 * 오히려 전체 장애라는 사실이 안 보인다.
 *
 * 타이머를 쓰지 않고 record() 시점에만 판단한다. 테스트에서 시간을 주입할 수
 * 있고 프로세스에 살아있는 타이머를 남기지 않는다.
 */
function createAlertAggregator({
  windowMs = ALERT_WINDOW_MS,
  cooldownMs = ALERT_COOLDOWN_MS,
  now = Date.now,
  // 기본값은 정책 파일이 정한다. 테스트에서만 주입한다.
  threshold = thresholdFor,
} = {}) {
  const buckets = new Map();

  function bucketFor(code) {
    // lastSentAt은 "아직 보낸 적 없음"을 0이 아니라 null로 둔다. 0으로 두면
    // 에포크 기준 경과 시간이 쿨다운보다 크냐를 묻는 꼴이 돼, 주입한 시계로는
    // 첫 알림이 영영 나가지 않는다.
    if (!buckets.has(code)) buckets.set(code, { events: [], lastSentAt: null });
    return buckets.get(code);
  }

  function summarize(code, tier, bucket) {
    const seen = new Map();
    for (const event of bucket.events) {
      if (!event.cafeId) continue;
      if (!seen.has(event.cafeId)) seen.set(event.cafeId, { id: event.cafeId, slug: event.slug || null });
    }
    const cafes = [...seen.values()];
    const last = bucket.events[bucket.events.length - 1];
    return {
      code,
      tier,
      count: bucket.events.length,
      windowMs,
      cafes: cafes.slice(0, MAX_LISTED_CAFES),
      hiddenCafeCount: Math.max(0, cafes.length - MAX_LISTED_CAFES),
      affectedCafeCount: cafes.length,
      route: last?.route || null,
      message: last?.message || null,
      firstAt: new Date(bucket.events[0].at).toISOString(),
      lastAt: new Date(last.at).toISOString(),
    };
  }

  return {
    /**
     * @returns 알릴 내용이 있으면 요약 객체, 아니면 null
     */
    record({ code, cause, cafeId = null, slug = null, route = null, message = null }) {
      const at = now();
      const tier = alertTierFor({ cause, code });
      if (tier === ALERT_TIER.LOG_ONLY) return null;

      const bucket = bucketFor(code);
      bucket.events = bucket.events.filter((event) => at - event.at < windowMs);
      bucket.events.push({ at, cafeId, slug, route, message });

      // 쿨다운 중에도 계속 기록해 둔다. 창이 유지되므로 쿨다운이 끝난 직후
      // 아직 문제가 이어지고 있으면 바로 다시 알릴 수 있다.
      if (bucket.lastSentAt !== null && at - bucket.lastSentAt < cooldownMs) return null;

      const shouldSend = tier === ALERT_TIER.IMMEDIATE
        || bucket.events.length >= threshold(code);
      if (!shouldSend) return null;

      const summary = summarize(code, tier, bucket);
      bucket.lastSentAt = at;
      bucket.events = [];
      return summary;
    },

    // 테스트와 진단용. 운영 경로에서는 사용하지 않는다.
    pendingCount(code) {
      return buckets.get(code)?.events.length || 0;
    },
  };
}

module.exports = { createAlertAggregator, MAX_LISTED_CAFES };
