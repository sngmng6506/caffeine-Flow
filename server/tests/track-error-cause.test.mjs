// 트랙 조회 실패의 원인 주체 분류 검사.
//
// 이 엔드포인트는 공개·무인증이라 손님 오타 하나가 곧 알림 한 건이 될 수 있다.
// 실제로 첫 구현은 axios의 error.response를 봤는데, 이 서비스가 던지는 건
// status만 있는 자체 에러라 모든 실패가 외부 장애로 분류됐다.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { trackErrorCause, naverCallbackError, alertTierFor, ALERT_TIER, CAUSE } = require('../src/observability/error-taxonomy');
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

  it('upstream 표식이 붙은 실패만 플랫폼 신호다', () => {
    expect(trackErrorCause({ code: 'TRACK_SOUNDCLOUD_PARSE_FAILED', upstream: true })).toBe(CAUSE.EXTERNAL);
    expect(trackErrorCause({ code: 'TRACK_DNS_FAILED', upstream: true })).toBe(CAUSE.EXTERNAL);
    expect(trackErrorCause({ code: 'TRACK_SOUNDCLOUD_FETCH_FAILED', upstream: false })).toBe(CAUSE.USER);
  });

  it('status 의미가 플랫폼마다 달라도 throw 지점의 판단을 따른다', () => {
    // SoundCloud 403은 서버 IP 차단(플랫폼 문제)이고 YouTube oEmbed 401은
    // 임베드 비활성화(손님이 고른 곡의 속성)다. 같은 4xx라도 결론이 다르다.
    expect(trackErrorCause({ upstream: true, upstreamStatus: 403 })).toBe(CAUSE.EXTERNAL);
    expect(trackErrorCause({ upstream: false, upstreamStatus: 401 })).toBe(CAUSE.USER);
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

describe('네이버 콜백 실패 분류', () => {
  const axiosError = (status) => Object.assign(new Error('naver'), {
    isAxiosError: true,
    response: status ? { status } : undefined,
  });

  it('우리 자격증명 거부는 즉시 알림 대상이다', () => {
    // client_secret 만료 시 전 사장님의 네이버 로그인이 막힌다
    for (const status of [401, 403]) {
      const result = naverCallbackError(axiosError(status));
      expect(result).toEqual({ code: 'NAVER_CREDENTIALS_REJECTED', cause: CAUSE.PLATFORM });
      expect(alertTierFor(result)).toBe(ALERT_TIER.IMMEDIATE);
    }
  });

  it('만료된 auth code 재사용은 손님 탓이다', () => {
    expect(naverCallbackError(axiosError(400))).toEqual({
      code: 'NAVER_CALLBACK_FAILED', cause: CAUSE.USER,
    });
  });

  it('네이버 서버 오류와 네트워크 실패는 외부 신호다', () => {
    for (const status of [500, 502, undefined]) {
      expect(naverCallbackError(axiosError(status)).cause).toBe(CAUSE.EXTERNAL);
    }
  });

  it('네이버 DNS 실패를 DB 장애로 오인하지 않는다', () => {
    // 이 catch가 DB 조회까지 감싸므로, 범용 소켓 코드만 보면 네이버 장애가
    // "서비스 전체 정지" 즉시 알림으로 둔갑한다
    const dnsFailure = Object.assign(new Error('getaddrinfo ENOTFOUND nid.naver.com'), {
      isAxiosError: true, code: 'ENOTFOUND',
    });
    expect(naverCallbackError(dnsFailure).code).toBe('NAVER_CALLBACK_FAILED');
  });

  it('실제 DB 연결 실패는 승격한다', () => {
    const dbFailure = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const result = naverCallbackError(dbFailure);
    expect(result).toEqual({ code: 'DB_CONNECTION_FAILED', cause: CAUSE.PLATFORM });
    expect(alertTierFor(result)).toBe(ALERT_TIER.IMMEDIATE);
  });
});
