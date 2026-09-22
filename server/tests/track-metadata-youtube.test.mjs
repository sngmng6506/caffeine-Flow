// 퍼가기(embed)가 꺼진 YouTube 영상도 신청되는지 검사.
//
// oEmbed는 퍼가기가 꺼진 영상에 401을 낸다. 하지만 이 앱은 임베드로 틀지 않는다
// — Electron이 youtube.com 워치 페이지를 그대로 연다. 그래서 oEmbed가 거절한
// 영상도 실제로는 재생된다. 예전에는 메타데이터를 못 받는다는 이유로 신청 자체를
// 막았다. 여기서 고정하는 것은 "oEmbed가 거절해도 워치 페이지로 살린다"이다.
//
// 네트워크와 DNS를 모두 가로채 외부에 나가지 않는다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axios = require('axios');
const dns = require('dns');
const { getTrackMetadata } = require('../src/services/track-metadata.service');

const WATCH_URL = 'https://www.youtube.com/watch?v=abc12345678';
const realAdapter = axios.defaults.adapter;
const realLookup = dns.lookup;

/** 요청 URL별 응답. 값이 number면 그 status로 거절한다. */
let routes;
let dnsAddresses;

function ok(data) {
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} };
}

beforeEach(() => {
  routes = {};
  // 실제 www.youtube.com은 A와 AAAA를 함께 준다. IPv4만 주는 스텁을 쓰면
  // assertPublicHost가 IPv6를 통째로 막던 버그를 가린다.
  dnsAddresses = [
    { address: '142.251.153.4', family: 4 },
    { address: '2001:4860:4827:400::', family: 6 },
  ];
  dns.lookup = (host, options, cb) => (cb || options)(null, dnsAddresses);
  axios.defaults.adapter = async (config) => {
    const url = config.params?.url && config.url?.includes('/oembed') ? 'oembed' : 'page';
    const outcome = routes[url];
    if (outcome === undefined) throw Object.assign(new Error('라우트 없음'), { response: { status: 500 } });
    if (typeof outcome === 'number') throw Object.assign(new Error(`HTTP ${outcome}`), { response: { status: outcome } });
    return ok(outcome);
  };
});

afterEach(() => {
  axios.defaults.adapter = realAdapter;
  dns.lookup = realLookup;
});

const pageHtml = (title, channel) =>
  `<html><head><meta property="og:title" content="${title}">`
  + (channel === null ? '' : `<script>{"ownerChannelName":"${channel}"}</script>`)
  + '</head></html>';

describe('YouTube 메타데이터', () => {
  it('oEmbed가 주면 그 값을 쓴다', async () => {
    routes.oembed = { title: '곡 제목', author_name: '채널' };
    const meta = await getTrackMetadata(WATCH_URL);

    expect(meta).toMatchObject({ platform: 'youtube', videoId: 'abc12345678', title: '곡 제목', channelTitle: '채널' });
  });

  it('퍼가기가 꺼져 401이 와도 워치 페이지로 신청을 살린다', async () => {
    routes.oembed = 401;
    routes.page = pageHtml('퍼가기 꺼진 곡', '음반사 채널');

    const meta = await getTrackMetadata(WATCH_URL);

    expect(meta.title).toBe('퍼가기 꺼진 곡');
    expect(meta.channelTitle).toBe('음반사 채널');
    expect(meta.thumbnail).toBe('https://img.youtube.com/vi/abc12345678/mqdefault.jpg');
  });

  it('이스케이프된 제목과 채널명을 풀어서 준다', async () => {
    routes.oembed = 401;
    // og:title은 HTML 엔티티, 페이지 JSON은 \uXXXX로 이스케이프돼 있다.
    routes.page = pageHtml('Tom &amp; Jerry &#39;24', '\\uc544\\uc774\\uc720');

    const meta = await getTrackMetadata(WATCH_URL);

    expect(meta.title).toBe("Tom & Jerry '24");
    expect(meta.channelTitle).toBe('아이유');
  });

  it('채널명을 못 읽어도 제목이 있으면 막지 않는다', async () => {
    routes.oembed = 401;
    routes.page = pageHtml('채널 없는 곡', null);

    expect((await getTrackMetadata(WATCH_URL)).channelTitle).toBe('YouTube');
  });

  it('없는 영상은 워치 페이지를 보지 않고 바로 안내한다', async () => {
    // 삭제된 영상도 워치 페이지는 200을 준다. 404에 fallback을 태우면 자리
    // 페이지의 og:title('YouTube')이 곡 제목이 된다.
    routes.oembed = 404;
    routes.page = pageHtml('YouTube', null);

    await expect(getTrackMetadata(WATCH_URL)).rejects.toMatchObject({
      code: 'TRACK_YOUTUBE_FETCH_FAILED',
      message: '영상 정보를 가져올 수 없습니다 (없는 영상이거나 비공개)',
      upstream: false,
    });
  });

  it('서버 IP 차단은 두 경로 중 하나만 가리켜도 플랫폼 신호다', async () => {
    routes.oembed = 401;
    routes.page = 403;

    await expect(getTrackMetadata(WATCH_URL)).rejects.toMatchObject({
      code: 'TRACK_YOUTUBE_FETCH_FAILED',
      upstream: true,
    });
  });

  it('자리 페이지가 와도 곡으로 받지 않는다', async () => {
    // oEmbed가 401을 내는 영상이 사실은 삭제된 경우다.
    routes.oembed = 401;
    routes.page = pageHtml('YouTube', null);

    await expect(getTrackMetadata(WATCH_URL)).rejects.toMatchObject({
      code: 'TRACK_YOUTUBE_UNAVAILABLE',
      message: '영상 정보를 가져올 수 없습니다 (없는 영상이거나 비공개)',
      upstream: false,
    });
  });

  it('dual-stack 호스트를 IPv6 때문에 막지 않는다', async () => {
    // isPrivateAddress가 IPv6를 통째로 막던 때는 이 경로가 항상 실패했다.
    routes.oembed = 401;
    routes.page = pageHtml('IPv6도 있는 곡', null);

    expect((await getTrackMetadata(WATCH_URL)).title).toBe('IPv6도 있는 곡');
  });

  it('내부 IP로 해석되는 호스트는 막고, 그 사정을 손님에게 알리지 않는다', async () => {
    routes.oembed = 401;
    routes.page = pageHtml('막혀야 하는 곡', null);
    dnsAddresses = [{ address: '127.0.0.1', family: 4 }];

    // 손님에게는 일반 문구만 가고, 우리는 신호로 받는다.
    await expect(getTrackMetadata(WATCH_URL)).rejects.toMatchObject({
      code: 'TRACK_YOUTUBE_FETCH_FAILED',
      message: '영상 정보를 가져올 수 없습니다 (잠시 후 다시 시도해 주세요)',
      upstream: true,
    });
  });

  it('제목의 백슬래시 문자열을 바꾸지 않는다', async () => {
    // og:title은 HTML 속성이라 JSON 언이스케이프를 걸면 "\\n"이 줄바꿈이 된다.
    routes.oembed = 401;
    routes.page = pageHtml('C:&#x5c;n drive &#x27;24', null);

    expect((await getTrackMetadata(WATCH_URL)).title).toBe("C:\\n drive '24");
  });

  it('페이지 형식이 바뀌어 제목을 못 읽으면 우리가 알아야 할 신호다', async () => {
    routes.oembed = 401;
    routes.page = '<html><head></head></html>';

    await expect(getTrackMetadata(WATCH_URL)).rejects.toMatchObject({
      code: 'TRACK_YOUTUBE_PARSE_FAILED',
      upstream: true,
    });
  });
});
