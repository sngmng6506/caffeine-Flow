// 트랙 조회 실패의 원인 주체 분류 검사.
//
// 이 엔드포인트는 공개·무인증이라 손님 오타 하나가 곧 알림 한 건이 될 수 있다.
// 실제로 첫 구현은 axios의 error.response를 봤는데, 이 서비스가 던지는 건
// status만 있는 자체 에러라 모든 실패가 외부 장애로 분류됐다.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { trackErrorCause, CAUSE } = require('../src/observability/error-taxonomy');
const { getTrackMetadata } = require('../src/services/track-metadata.service');

describe('트랙 조회 실패 분류', () => {
  it('입력 검증에서 걸린 실패는 손님 탓이다', () => {
    for (const code of [
      'TRACK_INVALID_YOUTUBE_URL',
      'TRACK_INVALID_SOUNDCLOUD_URL',
      'TRACK_INVALID_SPOTIFY_URL',
      'TRACK_UNSUPPORTED_PLATFORM',
      'TRACK_HOST_NOT_ALLOWED',
      'TRACK_PRIVATE_HOST',
    ]) {
      expect(trackErrorCause({ code, status: 400 })).toBe(CAUSE.USER);
    }
  });

  it('비공개·삭제된 곡은 손님 탓이다', () => {
    expect(trackErrorCause({ code: 'TRACK_SOUNDCLOUD_FETCH_FAILED', upstream: true, upstreamStatus: 404 }))
      .toBe(CAUSE.USER);
    expect(trackErrorCause({ code: 'TRACK_SOUNDCLOUD_FETCH_FAILED', upstream: true, upstreamStatus: 410 }))
      .toBe(CAUSE.USER);
  });

  it('차단·한도·서버 오류·네트워크 실패는 플랫폼 신호다', () => {
    for (const upstreamStatus of [403, 429, 500, 502, null]) {
      expect(trackErrorCause({ code: 'TRACK_SOUNDCLOUD_FETCH_FAILED', upstream: true, upstreamStatus }))
        .toBe(CAUSE.EXTERNAL);
    }
  });

  it('페이지 구조 변경과 DNS 실패는 플랫폼 신호다', () => {
    expect(trackErrorCause({ code: 'TRACK_SOUNDCLOUD_PARSE_FAILED', upstream: true })).toBe(CAUSE.EXTERNAL);
    expect(trackErrorCause({ code: 'TRACK_DNS_FAILED', upstream: true })).toBe(CAUSE.EXTERNAL);
  });

  it('axios 형태의 response만 있고 upstream 표식이 없으면 손님 탓으로 본다', () => {
    // 보수적으로 판단한다. 알림은 확실할 때만 나가는 편이 낫다.
    expect(trackErrorCause({ code: 'TRACK_METADATA_ERROR', response: { status: 500 } })).toBe(CAUSE.USER);
    expect(trackErrorCause(null)).toBe(CAUSE.USER);
  });

  it('실제로 던져지는 에러가 손님 탓으로 분류된다 (회귀 방지)', async () => {
    // 잘못된 URL을 넣었을 때 실제 코드 경로가 EXTERNAL로 새지 않는지 확인한다.
    for (const url of ['https://example.com/notmusic', 'not-a-url', '']) {
      const error = await getTrackMetadata(url).then(() => null, (e) => e);
      expect(error).toBeTruthy();
      expect(trackErrorCause(error)).toBe(CAUSE.USER);
    }
  });
});
