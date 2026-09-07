import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasVoted } from '../../votedSongs';
import useTopSongs from './useTopSongs';

const api = vi.hoisted(() => ({
  getCafeTop10: vi.fn(),
  getGlobalTop10: vi.fn(),
  voteSong: vi.fn(),
  unvoteSong: vi.fn(),
}));

vi.mock('../../api', () => api);

function topItem(overrides = {}) {
  return {
    video_id: 'song-1?si=tracking',
    title: '테스트 곡',
    total_votes: 2,
    count: 3,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  for (const mock of Object.values(api)) mock.mockReset();
  api.getCafeTop10.mockResolvedValue({ items: [topItem()], hasMore: false });
  api.getGlobalTop10.mockResolvedValue({ items: [topItem({ title: '전체 인기곡' })], hasMore: false });
});

afterEach(cleanup);

describe('TOP 조회', () => {
  it('활성 탭만 불러오고 탭별 목록을 보존한다', async () => {
    const { result, rerender } = renderHook(
      ({ tab }) => useTopSongs({ slug: 'cafe', tab }),
      { initialProps: { tab: 'cafeTop' } },
    );

    await waitFor(() => expect(result.current.items[0]?.title).toBe('테스트 곡'));
    expect(api.getCafeTop10).toHaveBeenCalledWith('cafe', 0, 'count');
    expect(api.getGlobalTop10).not.toHaveBeenCalled();

    rerender({ tab: 'globalTop' });
    await waitFor(() => expect(result.current.items[0]?.title).toBe('전체 인기곡'));
    expect(api.getGlobalTop10).toHaveBeenCalledWith(0, 'count');

    rerender({ tab: 'cafeTop' });
    expect(result.current.items[0].title).toBe('테스트 곡');
    expect(api.getCafeTop10).toHaveBeenCalledTimes(1);
  });

  it('실시간 곡 좋아요를 매장·전체 TOP에 모두 반영한다', async () => {
    const { result, rerender } = renderHook(
      ({ tab }) => useTopSongs({ slug: 'cafe', tab }),
      { initialProps: { tab: 'cafeTop' } },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    rerender({ tab: 'globalTop' });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.patchSongVote('song-1', 8));
    expect(result.current.items[0].total_votes).toBe(8);

    rerender({ tab: 'cafeTop' });
    expect(result.current.items[0].total_votes).toBe(8);
  });
});

describe('곡 좋아요', () => {
  it('좋아요와 취소 결과를 목록과 로컬 눌림 상태에 반영한다', async () => {
    api.voteSong.mockResolvedValue({ vote_count: 3 });
    api.unvoteSong.mockResolvedValue({ vote_count: 2 });
    const { result } = renderHook(() => useTopSongs({ slug: 'cafe', tab: 'cafeTop' }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    let voteCount;
    await act(async () => { voteCount = await result.current.toggleVote('song-1', false); });
    expect(voteCount).toBe(3);
    expect(api.voteSong).toHaveBeenCalledWith('cafe', 'song-1');
    expect(result.current.items[0].total_votes).toBe(3);
    expect(hasVoted('cafe', 'song-1')).toBe(true);

    await act(() => result.current.toggleVote('song-1', true));
    expect(api.unvoteSong).toHaveBeenCalledWith('cafe', 'song-1');
    expect(result.current.items[0].total_votes).toBe(2);
    expect(hasVoted('cafe', 'song-1')).toBe(false);
  });
});
