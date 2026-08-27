const axios = require('axios');
const { ALERT_TIER } = require('./error-taxonomy');

const SEND_TIMEOUT_MS = 3000;
const MESSAGE_MAX_LENGTH = 300;

// Discord embed 색상
const TIER_COLOR = Object.freeze({
  [ALERT_TIER.IMMEDIATE]: 0xE42939, // Danger
  [ALERT_TIER.THRESHOLD]: 0xF59F00, // Warning
});

/**
 * 알림 문구에서 비밀값을 지운다. 에러 메시지에는 헤더나 URL 조각이 섞여
 * 들어오는 경우가 있고, Discord는 외부 서비스다.
 */
function redact(text) {
  if (!text) return null;
  return String(text)
    .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [redacted]')
    .replace(/\b(sk|or)-[\w-]{8,}/gi, '[redacted-key]')
    .replace(/([?&](?:key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, MESSAGE_MAX_LENGTH);
}

/**
 * 외부로 나가는 페이로드를 명시적 allowlist로 구성한다.
 *
 * 절대 포함하지 않는 것: 매장 분위기 설명 원문, 손님 visitor ID·IP·신청자명,
 * 스택 트레이스. 앞의 둘은 저장소 계약(Public Response Boundary,
 * LLM Prompt and Safety)이 금지하고, 스택은 여기 실어봐야 읽지 않는다.
 * 상세는 운영자 콘솔과 서버 로그에서 본다.
 */
function buildAlertMessage(summary) {
  const immediate = summary.tier === ALERT_TIER.IMMEDIATE;
  const windowMinutes = Math.round(summary.windowMs / 60000);

  // 카페 수로 원인을 추론하는 건 임계값 알림에서만 의미가 있다. 즉시 알림은
  // 정의상 1건에 나가므로, 키 만료처럼 전 카페가 멈춘 상황에서도 카페 수는
  // 1이다. 여기서 "해당 매장 문제"라고 적으면 정반대로 오해하게 된다.
  const scope = immediate
    ? '첫 발생 시점에 보낸 알림 — 영향 범위는 아래 카페로 한정되지 않는다'
    : summary.affectedCafeCount > 1
      ? `${summary.affectedCafeCount}개 카페에서 발생 — 플랫폼 전체 문제일 가능성`
      : summary.affectedCafeCount === 1
        ? '카페 1곳에서 발생 — 해당 매장 설정 문제일 가능성'
        : '카페 범위 없음 (서버 전역)';

  const cafeList = summary.cafes.length
    ? summary.cafes.map((cafe) => `\`${cafe.slug || cafe.id}\``).join(', ')
      + (summary.hiddenCafeCount ? ` 외 ${summary.hiddenCafeCount}개` : '')
    : '—';

  const fields = [
    { name: '발생', value: immediate ? '1건 (즉시 알림 대상)' : `${windowMinutes}분간 ${summary.count}건`, inline: true },
    { name: '범위', value: scope, inline: false },
    { name: immediate ? '발생 카페' : '카페', value: cafeList, inline: false },
  ];
  if (summary.route) fields.push({ name: '경로', value: `\`${summary.route}\``, inline: true });
  if (summary.message) fields.push({ name: '메시지', value: `\`\`\`${redact(summary.message)}\`\`\``, inline: false });

  return {
    embeds: [{
      title: `${immediate ? '🚨' : '⚠️'} ${summary.code}`,
      color: TIER_COLOR[summary.tier] || TIER_COLOR[ALERT_TIER.THRESHOLD],
      fields,
      timestamp: summary.lastAt,
      footer: { text: 'Caffeine Flow' },
    }],
  };
}

/**
 * 알림 전송은 요청 처리를 막지 않고, 실패해도 조용히 포기한다.
 * 여기서 다시 logError를 부르면 알림 실패가 알림을 유발하는 무한 루프가 된다.
 */
function createAlertChannel({ webhookUrl, send = axios.post }) {
  if (!webhookUrl) return { enabled: false, deliver: () => Promise.resolve(false) };

  return {
    enabled: true,
    async deliver(summary) {
      try {
        await send(webhookUrl, buildAlertMessage(summary), { timeout: SEND_TIMEOUT_MS });
        return true;
      } catch (error) {
        console.error('[alert] 웹훅 전송 실패:', error?.response?.status || error?.code || error?.message);
        return false;
      }
    },
  };
}

module.exports = { createAlertChannel, buildAlertMessage, redact };
