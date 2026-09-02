// 재생 리더와 자동수락의 배선 검증.
//
// 순수 판단 로직(queuePolicy, playbackTransition 등)은 이미 .mjs 헬퍼로 빠져
// server 테스트가 덮는다. 여기서 잡으려는 건 그 헬퍼들을 "어느 자리에서
// 호출하는가"다. 리더가 아닌 화면이 재생을 시작해버리면 같은 카페에서 두 곡이
// 동시에 playing이 되는데, 그 실수는 순수 함수 테스트로는 절대 잡히지 않는다.
//
// 계약: docs/PLAYBACK.md#재생-리더와-시작-확인
//       docs/AI_CHANGE_GUARDRAILS.md#app-boundary-contract
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getRecommendations: vi.fn(),
  updateRec: vi.fn(),
  getMe: vi.fn(),
  setStatus: vi.fn(),
  updateMusicFilter: vi.fn(),
  finalizeManualPlayback: vi.fn(),
}));

// 소켓은 서버가 보내는 이벤트를 테스트가 직접 발사할 수 있어야 한다.
const socket = vi.hoisted(() => {
  const handlers = new Map();
  return {
    connected: true,
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    off: vi.fn(),
    emit: vi.fn(),
    handlers,
    fire: (event, payload) => handlers.get(event)?.(payload),
    reset() {
      handlers.clear();
      this.emit.mockClear();
    },
  };
});

vi.mock('../../api', () => api);
vi.mock('../../socket', () => ({
  getSocket: () => socket,
  disconnectSocket: vi.fn(),
}));

const { default: useRecommendationQueue } = await import('./useRecommendationQueue');

const CAFE = { id: 'cafe-1', slug: 'test-cafe', name: '테스트 카페' };

function rec(overrides = {}) {
  return {
    id: 'rec-1',
    video_id: 'vid-1',
    title: '곡',
    status: 'pending',
    filter_status: 'accepted',
    votes: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** playRec을 수락하는 정상 Electron 스텁. */
function electronStub() {
  const noop = () => () => {};
  return {
    playRec: vi.fn(async () => ({ ok: true })),
    endRec: vi.fn(),
    isRecActive: vi.fn(async () => false),
    supportsPlayRecAck: true,
    onNowPlaying: noop,
    onPlaybackState: noop,
    onCurrentTrack: noop,
    onManualTrackEnded: noop,
    onWidevineStatus: noop,
    onVideoEnded: noop,
    onRecLeft: noop,
    setBgmUrl: vi.fn(async () => true),
  };
}

function mount() {
  return renderHook(() => useRecommendationQueue({
    cafe: CAFE,
    setCafe: vi.fn(),
    setAllowedPlatforms: vi.fn(),
    setCustomerUrl: vi.fn(),
    onPromptRequired: vi.fn(),
  }));
}

/** 리더 역할을 부여하고 초기 복구 흐름까지 통과시킨다. */
async function becomeLeader({ shouldRecover = false } = {}) {
  await act(async () => {
    socket.fire('playback_role', { isLeader: true, shouldRecover });
  });
}

beforeEach(() => {
  // vi.fn()은 restoreMocks 대상이 아니라 테스트 간 호출 기록이 누적된다.
  // "호출되지 않아야 한다" 류의 단언이 앞선 테스트 때문에 깨지므로 먼저 비운다.
  for (const mock of Object.values(api)) mock.mockReset();
  socket.reset();
  socket.connected = true;
  window.electronAPI = electronStub();
  api.getRecommendations.mockResolvedValue({ recommendations: [], is_accepting: true });
  api.getMe.mockResolvedValue({ music_filter_enabled: true, name: '테스트 카페' });
  api.updateRec.mockImplementation(async (_slug, id, status) => ({ ...rec({ id }), status }));
  localStorage.clear();
});

afterEach(() => {
  delete window.electronAPI;
});

describe('재생 리더 게이트', () => {
  it('리더가 아니면 재생을 시작하지 않는다', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 역할 통보 없이 자동수락 대상이 들어온다
    await act(async () => {
      socket.fire('owner_recommendations_update', { action: 'add', rec: rec() });
    });

    expect(window.electronAPI.playRec).not.toHaveBeenCalled();
    expect(result.current.canControlPlayback).toBe(false);
  });

  it('리더가 아니어도 자동수락 자체는 수행한다', async () => {
    // 이건 의도된 동작이다. 수락은 서버 상태 전이라 중복돼도 서버가 흡수하고,
    // 리더 제한은 실제 재생 시작에만 걸린다. 이 구분이 바뀌면 여러 대가 붙었을 때
    // 아무도 수락하지 않거나 두 대가 동시에 재생하는 쪽으로 깨진다.
    const { result } = mount();
    await waitFor(() => expect(result.current.aiFilterReady).toBe(true));

    await act(async () => {
      socket.fire('owner_recommendations_update', { action: 'add', rec: rec() });
    });

    await waitFor(() => expect(api.updateRec).toHaveBeenCalledWith('test-cafe', 'rec-1', 'accepted'));
    expect(window.electronAPI.playRec).not.toHaveBeenCalled();
  });

  it('리더면 자동수락한 곡을 재생까지 시작한다', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.aiFilterReady).toBe(true));
    await becomeLeader();

    await act(async () => {
      socket.fire('owner_recommendations_update', { action: 'add', rec: rec() });
    });

    await waitFor(() => expect(window.electronAPI.playRec).toHaveBeenCalled());
    expect(result.current.canControlPlayback).toBe(true);
  });

  it('Electron이 없는 브라우저는 리더 통보를 받아도 재생을 맡지 않는다', async () => {
    delete window.electronAPI;
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await becomeLeader();

    expect(result.current.canControlPlayback).toBe(false);
  });

  it('리더 역할이 회수되면 재생 조작 권한도 사라진다', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await becomeLeader();
    expect(result.current.canControlPlayback).toBe(true);

    await act(async () => {
      socket.fire('playback_role', { isLeader: false });
    });
    expect(result.current.canControlPlayback).toBe(false);
  });
});

describe('자동수락 조건', () => {
  it('AI 필터가 꺼져 있으면 승격하지 않는다', async () => {
    api.getMe.mockResolvedValue({ music_filter_enabled: false });
    const { result } = mount();
    await waitFor(() => expect(result.current.aiFilterReady).toBe(true));
    await becomeLeader();

    await act(async () => {
      socket.fire('owner_recommendations_update', { action: 'add', rec: rec() });
    });

    expect(api.updateRec).not.toHaveBeenCalled();
    expect(window.electronAPI.playRec).not.toHaveBeenCalled();
  });

  it('필터를 거치지 않은 곡(skipped)은 승격하지 않는다', async () => {
    // 필터가 꺼져 있는 동안 들어온 곡이다. 나중에 필터를 켜도 승격 대상이 아니다.
    const { result } = mount();
    await waitFor(() => expect(result.current.aiFilterReady).toBe(true));
    await becomeLeader();

    await act(async () => {
      socket.fire('owner_recommendations_update', { action: 'add', rec: rec({ filter_status: 'skipped' }) });
    });

    expect(api.updateRec).not.toHaveBeenCalled();
  });

  it('AI가 거절한 곡은 승격하지 않는다', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.aiFilterReady).toBe(true));
    await becomeLeader();

    await act(async () => {
      socket.fire('owner_recommendations_update', {
        action: 'add',
        rec: rec({ status: 'rejected', filter_status: 'rejected' }),
      });
    });

    expect(api.updateRec).not.toHaveBeenCalled();
  });

  it('수락 요청이 실패해도 곡은 목록에 남는다', async () => {
    api.updateRec.mockRejectedValue(new Error('네트워크'));
    const { result } = mount();
    await waitFor(() => expect(result.current.aiFilterReady).toBe(true));

    await act(async () => {
      socket.fire('owner_recommendations_update', { action: 'add', rec: rec() });
    });

    await waitFor(() => expect(result.current.recommendations).toHaveLength(1));
  });
});

describe('재생 시작 순서', () => {
  it('Electron이 거절하면 DB를 playing으로 바꾸지 않는다', async () => {
    window.electronAPI.playRec = vi.fn(async () => ({ ok: false, error: 'URL 거절' }));
    const { result } = mount();
    await waitFor(() => expect(result.current.aiFilterReady).toBe(true));
    await becomeLeader();

    await act(async () => {
      socket.fire('owner_recommendations_update', { action: 'add', rec: rec() });
    });

    await waitFor(() => expect(window.electronAPI.playRec).toHaveBeenCalled());
    expect(api.updateRec).not.toHaveBeenCalledWith('test-cafe', 'rec-1', 'playing');
  });

  it('DB 갱신이 실패하면 실제 플레이어를 되돌린다', async () => {
    api.updateRec.mockImplementation(async (_slug, id, status) => {
      if (status === 'playing') throw new Error('DB 실패');
      return { ...rec({ id }), status };
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.aiFilterReady).toBe(true));
    await becomeLeader();

    await act(async () => {
      socket.fire('owner_recommendations_update', { action: 'add', rec: rec() });
    });

    await waitFor(() => expect(window.electronAPI.endRec).toHaveBeenCalled());
  });

  it('이미 재생 중이면 새 곡을 덮어쓰지 않는다', async () => {
    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ id: 'playing-1', status: 'playing' })],
      is_accepting: true,
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.recommendations).toHaveLength(1));
    await becomeLeader();

    await act(async () => {
      socket.fire('owner_recommendations_update', { action: 'add', rec: rec({ id: 'rec-2' }) });
    });

    await waitFor(() => expect(api.updateRec).toHaveBeenCalledWith('test-cafe', 'rec-2', 'accepted'));
    expect(window.electronAPI.playRec).not.toHaveBeenCalled();
  });
});

describe('리더 선출 요청', () => {
  it('연결되면 역할을 서버에 요청한다', async () => {
    mount();
    await act(async () => {
      socket.fire('connect');
    });
    expect(socket.emit).toHaveBeenCalledWith('request_playback_role');
  });
});
