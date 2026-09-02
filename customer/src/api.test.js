// 손님 HTTP 계층.
//
// 모든 요청에 visitor ID 헤더가 붙어야 서버가 취소 권한과 중복 투표를 판단할
// 수 있다. 엔드포인트를 추가하면서 apiFetch를 우회하면 그 요청만 조용히
// 익명이 되므로, 헤더가 아니라 "모든 export가 같은 통로를 지나는지"를 본다.
//
// 계약: docs/AI_CHANGE_GUARDRAILS.md#anonymous-visitor-identity-contract
//       docs/API.md
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as api from './api';

function mockFetch(response = {}) {
  const fetch = vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify(response),
  }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('요청 공통 규약', () => {
  it('모든 요청에 visitor ID 헤더를 붙인다', async () => {
    const fetch = mockFetch();
    // export된 모든 호출을 한 번씩 지나가게 해 우회 경로가 없는지 확인한다.
    const calls = [
      () => api.getRecommendations('cafe'),
      () => api.getRecentHistory('cafe'),
      () => api.postRecommendation('cafe', {}),
      () => api.vote('cafe', 'rec-1'),
      () => api.unvote('cafe', 'rec-1'),
      () => api.cancelRecommendation('cafe', 'rec-1'),
      () => api.getOembed('https://youtu.be/x'),
      () => api.getCafeTop10('cafe'),
      () => api.getGlobalTop10(),
      () => api.getSongComments('vid'),
      () => api.postSongComment('vid', 'cafe', {}),
      () => api.postSongReply('vid', 'c-1', 'cafe', {}),
    ];
    for (const call of calls) await call();

    expect(fetch).toHaveBeenCalledTimes(calls.length);
    for (const [, init] of fetch.mock.calls) {
      expect(init.headers['X-Visitor-Id']).toBeTruthy();
    }
  });

  it('같은 세션에서는 항상 같은 visitor ID를 보낸다', async () => {
    const fetch = mockFetch();
    await api.getRecommendations('cafe');
    await api.vote('cafe', 'rec-1');
    const [first, second] = fetch.mock.calls.map(([, init]) => init.headers['X-Visitor-Id']);
    expect(first).toBe(second);
  });

  it('모든 경로가 /api/v1 아래에 있다', async () => {
    const fetch = mockFetch();
    await api.getRecommendations('cafe');
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/cafes/cafe/recommendations');
  });

  it('본문 없는 요청에는 body를 붙이지 않는다', async () => {
    const fetch = mockFetch();
    await api.vote('cafe', 'rec-1');
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('body');
  });
});

describe('오류 처리', () => {
  it('서버가 준 문구를 그대로 보여준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      text: async () => JSON.stringify({ error: '이미 신청된 곡이에요.' }),
    })));
    await expect(api.postRecommendation('cafe', {})).rejects.toThrow('이미 신청된 곡이에요.');
  });

  it('문구가 없으면 손님용 기본 안내로 대체한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })));
    // 내부 오류 코드나 스택을 손님에게 노출하지 않는다.
    await expect(api.getRecommendations('cafe')).rejects.toThrow('요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  });

  it('본문이 빈 성공 응답을 빈 객체로 다룬다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '' })));
    await expect(api.cancelRecommendation('cafe', 'rec-1')).resolves.toEqual({});
  });
});

describe('URL 조립', () => {
  it('곡 ID를 인코딩해 경로를 깨지 않는다', async () => {
    const fetch = mockFetch();
    await api.getSongComments('https://soundcloud.com/a/b');
    expect(fetch.mock.calls[0][0]).toContain(encodeURIComponent('https://soundcloud.com/a/b'));
  });

  it('매장 댓글과 전체 댓글은 다른 경로를 쓴다', async () => {
    const fetch = mockFetch();
    await api.postSongComment('vid', 'cafe', {});
    await api.postSongComment('vid', null, {});
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/cafes/cafe/songs/vid/comments');
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/songs/vid/comments');
  });
});
