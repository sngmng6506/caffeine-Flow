// 알림 페이로드 경계 검사.
//
// Discord는 외부 서비스다. 매장 분위기 설명 원문과 손님 식별자를 공개 응답에
// 넣지 않는다는 저장소 계약은 이 채널에도 그대로 적용된다.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildAlertMessage, redact, createAlertChannel } = require('../src/observability/alert-channel');
const { ALERT_TIER } = require('../src/observability/error-taxonomy');

const summary = {
  code: 'LLM_TIMEOUT',
  tier: ALERT_TIER.THRESHOLD,
  count: 5,
  windowMs: 5 * 60 * 1000,
  cafes: [{ id: 'cafe-a', slug: 'alpha' }],
  hiddenCafeCount: 0,
  affectedCafeCount: 1,
  route: 'POST /cafes/:slug/recommendations',
  message: 'LLM API timeout',
  firstAt: '2026-08-27T00:00:00.000Z',
  lastAt: '2026-08-27T00:04:00.000Z',
};

describe('알림 페이로드', () => {
  it('비밀값을 지운다', () => {
    expect(redact('Authorization: Bearer sk-or-v1-abcdef123456')).not.toContain('abcdef123456');
    expect(redact('key=sk-or-v1-abcdef123456 실패')).toContain('[redacted');
    expect(redact('https://x.test/a?token=supersecretvalue')).not.toContain('supersecretvalue');
  });

  it('긴 메시지를 잘라 채널을 넘치게 하지 않는다', () => {
    expect(redact('가'.repeat(5000)).length).toBeLessThanOrEqual(300);
  });

  it('영향 범위를 카페 수로 설명한다', () => {
    const single = JSON.stringify(buildAlertMessage(summary));
    expect(single).toContain('카페 1곳');
    const many = JSON.stringify(buildAlertMessage({ ...summary, affectedCafeCount: 4 }));
    expect(many).toContain('4개 카페');
    expect(many).toContain('플랫폼 전체');
  });

  it('즉시 알림은 카페 수로 원인을 추론하지 않는다', () => {
    // 키 만료는 전 카페가 멈춘 상황인데도 1건에 나가므로 카페 수가 1이다.
    // 여기서 "해당 매장 문제"라고 적으면 정반대로 읽힌다.
    const payload = JSON.stringify(buildAlertMessage({
      ...summary,
      code: 'LLM_HTTP_401',
      tier: ALERT_TIER.IMMEDIATE,
      count: 1,
    }));
    expect(payload).not.toContain('해당 매장 설정 문제');
    expect(payload).toContain('판단하기에는 부족하다');
  });

  it('1건짜리 임계값 알림도 범위를 단정하지 않는다', () => {
    // DEFAULT_THRESHOLD가 1이면 첫 알림은 항상 1건 1카페다. 표본이 없는데
    // "해당 매장 문제"라고 적으면 전 카페 장애를 한 매장 문제로 오독하게 된다.
    const payload = JSON.stringify(buildAlertMessage({ ...summary, count: 1 }));
    expect(payload).not.toContain('해당 매장 설정 문제');
    expect(payload).toContain('판단하기에는 부족하다');
  });

  it('2건 이상 쌓였을 때만 매장 문제로 좁힌다', () => {
    const payload = JSON.stringify(buildAlertMessage({ ...summary, count: 3 }));
    expect(payload).toContain('카페 1곳에서 반복 발생');
  });

  it('카페 범위가 없는 서버 전역 오류는 그렇게 표시한다', () => {
    // INTERNAL_ERROR·UNCAUGHT_EXCEPTION은 카페가 없고 대개 1건짜리라,
    // 표본 부족 분기에 먼저 걸리면 서버 전역이라는 사실을 잃는다.
    const payload = JSON.stringify(buildAlertMessage({
      ...summary, code: 'UNCAUGHT_EXCEPTION', count: 1, cafes: [], affectedCafeCount: 0,
    }));
    expect(payload).toContain('카페 범위 없음 (서버 전역)');
  });

  it('금지된 필드는 어떤 경로로도 실리지 않는다', () => {
    const payload = JSON.stringify(buildAlertMessage({
      ...summary,
      // 호출부가 실수로 넣더라도 allowlist 구성이라 통과하지 못해야 한다
      cafePrompt: '조용한 재즈만 받아주세요',
      visitorId: 'visitor-1234',
      requesterIp: '203.0.113.9',
      requesterName: '홍길동',
      stack: 'Error: at Object.<anonymous> (/app/server/secret.js:1:1)',
    }));
    for (const forbidden of ['조용한 재즈', 'visitor-1234', '203.0.113.9', '홍길동', 'secret.js']) {
      expect(payload).not.toContain(forbidden);
    }
  });

  it('웹훅 URL이 없으면 채널이 비활성이고 전송을 시도하지 않는다', async () => {
    const channel = createAlertChannel({ webhookUrl: '' });
    expect(channel.enabled).toBe(false);
    await expect(channel.deliver(summary)).resolves.toBe(false);
  });

  it('전송 실패가 호출부로 새어나가지 않는다', async () => {
    const channel = createAlertChannel({
      webhookUrl: 'https://discord.test/webhook',
      send: () => Promise.reject(new Error('boom')),
    });
    await expect(channel.deliver(summary)).resolves.toBe(false);
  });

  it('설정된 웹훅 URL로 한 번만 POST한다', async () => {
    const calls = [];
    const channel = createAlertChannel({
      webhookUrl: 'https://discord.test/webhook',
      send: (...args) => { calls.push(args); return Promise.resolve({ status: 204 }); },
    });
    await channel.deliver(summary);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('https://discord.test/webhook');
    expect(calls[0][1].embeds[0].title).toContain('LLM_TIMEOUT');
  });
});
