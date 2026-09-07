import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useCafeQueue from './useCafeQueue';

const mocks = vi.hoisted(() => {
  const handlers = {};
  const socket = {
    on: vi.fn((event, handler) => { handlers[event] = handler; }),
  };
  return {
    handlers,
    socket,
    getRecommendations: vi.fn(),
    getSocket: vi.fn(() => socket),
    disconnectSocket: vi.fn(),
  };
});

vi.mock('../../api', () => ({ getRecommendations: mocks.getRecommendations }));
vi.mock('../../socket', () => ({
  getSocket: mocks.getSocket,
  disconnectSocket: mocks.disconnectSocket,
}));

function recommendation(overrides = {}) {
  return {
    id: 'rec-1',
    video_id: 'song-1?si=tracking',
    status: 'pending',
    vote_count: 1,
    requested_at: '2026-09-07T00:00:00.000Z',
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    recommendations: [],
    is_accepting: true,
    notice: null,
    cafe_name: '첫 카페',
    allowed_platforms: ['youtube'],
    ...overrides,
  };
}

function setup() {
  const callbacks = {
    onHistoryTransition: vi.fn(),
    onHistoryUpdate: vi.fn(),
    onSongVote: vi.fn(),
  };
  return {
    callbacks,
    hook: renderHook(() => useCafeQueue({ slug: 'cafe', ...callbacks })),
  };
}

beforeEach(() => {
  for (const key of Object.keys(mocks.handlers)) delete mocks.handlers[key];
  mocks.socket.on.mockClear();
  mocks.getSocket.mockClear();
  mocks.disconnectSocket.mockClear();
  mocks.getRecommendations.mockReset();
});

afterEach(cleanup);

describe('큐 스냅샷', () => {
  it('연결이 끊겼다가 다시 붙으면 서버 상태를 다시 조회한다', async () => {
    mocks.getRecommendations
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ cafe_name: '갱신된 카페' }));
    const { hook } = setup();

    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.cafeName).toBe('첫 카페');

    act(() => mocks.handlers.connect());
    expect(mocks.getRecommendations).toHaveBeenCalledTimes(1);

    act(() => mocks.handlers.connect());
    await waitFor(() => expect(hook.result.current.cafeName).toBe('갱신된 카페'));
    expect(mocks.getRecommendations).toHaveBeenNthCalledWith(2, 'cafe');
  });

  it('활성 큐의 상태별 목록과 순서를 만든다', async () => {
    mocks.getRecommendations.mockResolvedValue(snapshot({
      recommendations: [
        recommendation({ id: 'playing', status: 'playing' }),
        recommendation({ id: 'accepted-low', status: 'accepted', vote_count: 1 }),
        recommendation({ id: 'accepted-high', video_id: 'song-2', status: 'accepted', vote_count: 5 }),
        recommendation({ id: 'pending', video_id: 'song-3', status: 'pending' }),
      ],
    }));
    const { hook } = setup();

    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    expect(hook.result.current.nowPlaying.id).toBe('playing');
    expect(hook.result.current.waitingQueue.map(item => item.id)).toEqual(['accepted-high', 'accepted-low']);
    expect(hook.result.current.pendingQueue.map(item => item.id)).toEqual(['pending']);
    expect(hook.result.current.activeVideoIds).toEqual([
      'song-1?si=tracking',
      'song-1?si=tracking',
      'song-2',
      'song-3',
    ]);
  });
});

describe('실시간 변경', () => {
  it('종료된 곡은 큐에서 제거하고 최근 재생 훅으로 넘긴다', async () => {
    const active = recommendation();
    const terminal = recommendation({ status: 'played', played_at: '2026-09-07T00:10:00.000Z' });
    mocks.getRecommendations.mockResolvedValue(snapshot({ recommendations: [active] }));
    const { hook, callbacks } = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    act(() => mocks.handlers.recommendations_update({ action: 'update', rec: terminal }));

    expect(hook.result.current.recommendations).toEqual([]);
    expect(callbacks.onHistoryTransition).toHaveBeenCalledWith(terminal);
  });

  it('곡 좋아요를 같은 곡의 큐 행에 반영하고 상위 조립점에도 알린다', async () => {
    mocks.getRecommendations.mockResolvedValue(snapshot({
      recommendations: [recommendation(), recommendation({ id: 'other', video_id: 'song-2' })],
    }));
    const { hook, callbacks } = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    act(() => mocks.handlers.song_vote({ track_key: 'song-1', vote_count: 7 }));

    expect(hook.result.current.recommendations.map(item => item.vote_count)).toEqual([7, 1]);
    expect(callbacks.onSongVote).toHaveBeenCalledWith('song-1', 7);
  });

  it('언마운트할 때 카페 소켓 연결을 정리한다', async () => {
    mocks.getRecommendations.mockResolvedValue(snapshot());
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    hook.unmount();

    expect(mocks.disconnectSocket).toHaveBeenCalledOnce();
  });
});
