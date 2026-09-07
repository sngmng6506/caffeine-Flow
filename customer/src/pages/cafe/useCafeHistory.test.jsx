import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useCafeHistory from './useCafeHistory';

const getRecentHistory = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ getRecentHistory }));

function historyItem(overrides = {}) {
  return {
    id: 'history-1',
    video_id: 'song-1?si=tracking',
    vote_count: 1,
    status: 'played',
    requested_at: '2026-09-06T00:00:00.000Z',
    played_at: '2026-09-06T00:10:00.000Z',
    ...overrides,
  };
}

beforeEach(() => getRecentHistory.mockReset());
afterEach(cleanup);

describe('최근 재생 조회', () => {
  it('탭이 열리기 전에는 요청하지 않고 활성화되면 최신순으로 정렬한다', async () => {
    getRecentHistory.mockResolvedValue({
      items: [
        historyItem(),
        historyItem({ id: 'history-2', video_id: 'song-2', played_at: '2026-09-07T00:10:00.000Z' }),
      ],
      hasMore: false,
    });
    const { result, rerender } = renderHook(
      ({ active }) => useCafeHistory({ slug: 'cafe', active }),
      { initialProps: { active: false } },
    );

    expect(getRecentHistory).not.toHaveBeenCalled();
    rerender({ active: true });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getRecentHistory).toHaveBeenCalledWith('cafe', 0);
    expect(result.current.items.map(item => item.id)).toEqual(['history-2', 'history-1']);
  });

  it('다음 페이지를 합칠 때 이미 받은 행을 중복 추가하지 않는다', async () => {
    getRecentHistory
      .mockResolvedValueOnce({ items: [historyItem()], hasMore: true })
      .mockResolvedValueOnce({
        items: [historyItem(), historyItem({ id: 'history-2', video_id: 'song-2' })],
        hasMore: false,
      });
    const { result } = renderHook(() => useCafeHistory({ slug: 'cafe', active: true }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(() => result.current.loadMore());

    expect(getRecentHistory).toHaveBeenNthCalledWith(2, 'cafe', 1);
    expect(result.current.items.map(item => item.id).sort()).toEqual(['history-1', 'history-2']);
    expect(result.current.hasMore).toBe(false);
  });
});

describe('실시간 이력 반영', () => {
  it('새 종료 곡을 추가하고 같은 곡의 좋아요 값을 함께 갱신한다', async () => {
    getRecentHistory.mockResolvedValue({ items: [historyItem()], hasMore: false });
    const { result } = renderHook(() => useCafeHistory({ slug: 'cafe', active: true }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => {
      result.current.upsertRecommendation(historyItem({
        id: 'history-2',
        played_at: '2026-09-07T00:10:00.000Z',
      }));
      result.current.patchSongVote('song-1', 9);
    });

    expect(result.current.items.map(item => item.id)).toEqual(['history-2', 'history-1']);
    expect(result.current.items.map(item => item.vote_count)).toEqual([9, 9]);
  });
});
