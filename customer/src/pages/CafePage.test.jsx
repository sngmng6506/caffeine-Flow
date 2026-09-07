import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CafePage from './CafePage';

const hooks = vi.hoisted(() => ({
  queueOptions: null,
  history: {
    loadMore: vi.fn(),
    retry: vi.fn(),
    upsertRecommendation: vi.fn(),
    updateRecommendation: vi.fn(),
    patchSongVote: vi.fn(),
  },
  top: {
    retry: vi.fn(),
    loadMore: vi.fn(),
    changeSort: vi.fn(),
    patchSongVote: vi.fn(),
    toggleVote: vi.fn(),
  },
  queue: {
    addRecommendation: vi.fn(),
    updateRecommendation: vi.fn(),
    removeRecommendation: vi.fn(),
    patchSongVote: vi.fn(),
  },
}));

vi.mock('./cafe/useCafeHistory', () => ({
  default: () => ({
    items: [],
    hasMore: false,
    loading: false,
    error: '',
    ...hooks.history,
  }),
}));

vi.mock('./cafe/useTopSongs', () => ({
  default: () => ({
    items: [],
    hasMore: false,
    loading: false,
    error: '',
    sortBy: 'count',
    ...hooks.top,
  }),
}));

vi.mock('./cafe/useCafeQueue', () => ({
  default: (options) => {
    hooks.queueOptions = options;
    return {
      recommendations: [],
      isAccepting: true,
      notice: null,
      cafeName: '테스트 카페',
      allowedPlatforms: ['youtube'],
      playbackState: { state: 'unknown', recommendationId: null, track: null },
      loading: false,
      error: '',
      nowPlaying: null,
      waitingQueue: [],
      pendingQueue: [],
      activeVideoIds: [],
      ...hooks.queue,
    };
  },
}));

vi.mock('./NowPlaying', () => ({ default: () => null }));
vi.mock('./RecommendForm', () => ({ default: () => null }));
vi.mock('./SongCard', () => ({ default: () => null }));
vi.mock('./CafeComments', () => ({ default: () => null }));
vi.mock('./StatePanel', () => ({ default: () => null }));
vi.mock('./Top10List', () => ({
  default: ({ onVote }) => (
    <button type='button' onClick={() => onVote('song-1', false)}>TOP 좋아요</button>
  ),
}));

beforeEach(() => {
  hooks.queueOptions = null;
  for (const group of [hooks.history, hooks.top, hooks.queue]) {
    for (const mock of Object.values(group)) mock.mockReset();
  }
  hooks.top.toggleVote.mockResolvedValue(6);
});

afterEach(cleanup);

describe('추천곡 데이터 조립', () => {
  it('큐 훅의 이력 이벤트를 최근 재생 훅에 연결한다', () => {
    render(<CafePage slug='cafe' />);

    expect(hooks.queueOptions.onHistoryTransition).toBe(hooks.history.upsertRecommendation);
    expect(hooks.queueOptions.onHistoryUpdate).toBe(hooks.history.updateRecommendation);
  });

  it('실시간 곡 좋아요를 최근 재생과 양쪽 TOP에 전달한다', () => {
    render(<CafePage slug='cafe' />);

    act(() => hooks.queueOptions.onSongVote('song-1', 5));

    expect(hooks.history.patchSongVote).toHaveBeenCalledWith('song-1', 5);
    expect(hooks.top.patchSongVote).toHaveBeenCalledWith('song-1', 5);
  });

  it('TOP에서 누른 좋아요를 큐와 최근 재생에도 같은 값으로 반영한다', async () => {
    render(<CafePage slug='cafe' />);
    fireEvent.click(screen.getByRole('tab', { name: '테스트 카페 TOP' }));
    fireEvent.click(screen.getByRole('button', { name: 'TOP 좋아요' }));

    await waitFor(() => expect(hooks.top.toggleVote).toHaveBeenCalledWith('song-1', false));
    expect(hooks.queue.patchSongVote).toHaveBeenCalledWith('song-1', 6);
    expect(hooks.history.patchSongVote).toHaveBeenCalledWith('song-1', 6);
  });
});
