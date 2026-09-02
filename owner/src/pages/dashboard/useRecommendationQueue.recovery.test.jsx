// 재생 리더 복구 흐름 검증.
//
// 여기가 이 훅에서 가장 위험한 구간이다. 잘못 건드리면 두 증상 중 하나가 난다.
//   - 복구를 너무 많이 함: renderer reload마다 재생 중인 곡을 accepted로 되돌려
//     사장님 화면에서 음악이 끊긴다
//   - 복구를 안 함: 서버에 고아 playing이 남아 다음 곡이 영영 시작되지 않는다
//
// 두 증상 모두 실제 매장에서만 드러나므로 경계 조건을 촘촘히 고정한다.
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

// 복구는 ACK 왕복이 핵심이라 socket.timeout(ms).emit(event, cb)까지 흉내낸다.
const socket = vi.hoisted(() => {
  const handlers = new Map();
  return {
    connected: true,
    ackResult: { error: null, response: { ok: true } },
    ackCalls: 0,
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    off: vi.fn(),
    emit: vi.fn(),
    timeout() {
      return {
        emit: (_event, callback) => {
          this.ackCalls += 1;
          const { error, response } = this.ackResult;
          // 서버 응답은 다음 tick에 온다 — 동기 resolve로 순서를 왜곡하지 않는다
          setTimeout(() => callback(error, response), 0);
        },
      };
    },
    fire: (event, payload) => handlers.get(event)?.(payload),
    reset() {
      handlers.clear();
      this.emit.mockClear();
      this.connected = true;
      this.ackResult = { error: null, response: { ok: true } };
      this.ackCalls = 0;
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
const PLAYING = 'playing';
const ACCEPTED = 'accepted';

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

function electronStub(overrides = {}) {
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
    onCleanupBeforeQuit: noop,
    setBgmUrl: vi.fn(async () => true),
    ...overrides,
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

/** playback_role 이벤트를 쏘고 비동기 복구가 끝날 여유를 준다. */
async function fireRole(payload) {
  await act(async () => {
    socket.fire('playback_role', payload);
    await new Promise(resolve => setTimeout(resolve, 10));
  });
}

const acceptedCalls = () =>
  api.updateRec.mock.calls.filter(([, , status]) => status === ACCEPTED);

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  socket.reset();
  window.electronAPI = electronStub();
  api.getRecommendations.mockResolvedValue({ recommendations: [], is_accepting: true });
  api.getMe.mockResolvedValue({ music_filter_enabled: false });
  api.updateRec.mockImplementation(async (_slug, id, status) => ({ ...rec({ id }), status }));
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  delete window.electronAPI;
});

describe('복구 대상 판정', () => {
  it('shouldRecover가 없으면 역할만 받고 다시 물어본다', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    socket.emit.mockClear();

    await fireRole({ isLeader: true });

    expect(socket.emit).toHaveBeenCalledWith('request_playback_role');
    expect(socket.ackCalls).toBe(0);
    expect(acceptedCalls()).toHaveLength(0);
  });

  it('리더가 아니면 복구하지 않는다', async () => {
    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ status: PLAYING })],
      is_accepting: true,
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.recommendations).toHaveLength(1));

    await fireRole({ isLeader: false, shouldRecover: true });

    expect(socket.ackCalls).toBe(0);
    expect(acceptedCalls()).toHaveLength(0);
  });

  it('복구가 필요 없으면 ACK도 보내지 않는다', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await fireRole({ isLeader: true, shouldRecover: false });

    expect(socket.ackCalls).toBe(0);
    expect(acceptedCalls()).toHaveLength(0);
  });
});

describe('같은 실행 세션 유지', () => {
  it('Electron이 아직 재생 중이면 DB를 되돌리지 않고 ACK만 보낸다', async () => {
    // 서버 프로세스만 재시작된 경우다. registry는 새 리더로 보지만 실제
    // 재생은 끊기지 않았으므로 playing을 accepted로 되돌리면 음악이 끊긴다.
    window.electronAPI = electronStub({ isRecActive: vi.fn(async () => true) });
    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ status: PLAYING })],
      is_accepting: true,
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.recommendations).toHaveLength(1));

    await fireRole({ isLeader: true, shouldRecover: true });

    expect(socket.ackCalls).toBe(1);
    expect(acceptedCalls()).toHaveLength(0);
  });

  it('isRecActive가 실패하면 세션 marker로 판단한다', async () => {
    // 구버전 preload에는 이 채널이 없다. 예외가 복구 자체를 막으면 안 된다.
    window.electronAPI = electronStub({
      isRecActive: vi.fn(async () => { throw new Error('채널 없음'); }),
    });
    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ status: PLAYING })],
      is_accepting: true,
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.recommendations).toHaveLength(1));

    await fireRole({ isLeader: true, shouldRecover: true });

    // marker가 없는 새 세션이므로 복구가 진행된다
    expect(acceptedCalls()).toHaveLength(1);
    expect(socket.ackCalls).toBe(1);
  });
});

describe('새 리더 복구', () => {
  it('고아 playing을 accepted로 되돌리고 ACK를 보낸다', async () => {
    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ id: 'orphan', status: PLAYING }), rec({ id: 'other' })],
      is_accepting: true,
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.recommendations).toHaveLength(2));

    await fireRole({ isLeader: true, shouldRecover: true });

    expect(api.updateRec).toHaveBeenCalledWith('test-cafe', 'orphan', ACCEPTED);
    expect(acceptedCalls()).toHaveLength(1); // playing이 아닌 곡은 건드리지 않는다
    expect(socket.ackCalls).toBe(1);
  });

  it('AI 필터가 켜져 있으면 복구 뒤 대기 곡을 이어서 재생한다', async () => {
    api.getMe.mockResolvedValue({ music_filter_enabled: true });
    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ id: 'orphan', status: PLAYING })],
      is_accepting: true,
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.aiFilterReady).toBe(true));

    await fireRole({ isLeader: true, shouldRecover: true });

    await waitFor(() => expect(window.electronAPI.playRec).toHaveBeenCalled());
  });

  it('AI 필터가 꺼져 있으면 복구만 하고 재생하지 않는다', async () => {
    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ id: 'orphan', status: PLAYING })],
      is_accepting: true,
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await fireRole({ isLeader: true, shouldRecover: true });

    expect(acceptedCalls()).toHaveLength(1);
    expect(window.electronAPI.playRec).not.toHaveBeenCalled();
  });

  it('Electron이 재생 중이 아니라고 하면 요청받을 때마다 복구한다', async () => {
    // isRecActive는 메인 프로세스의 실제 재생 모드라 세션 marker보다 우선한다.
    // false라면 정말로 고아 playing이 남아 있다는 뜻이므로 매번 정리해야 한다.
    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ id: 'orphan', status: PLAYING })],
      is_accepting: true,
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await fireRole({ isLeader: true, shouldRecover: true });
    expect(acceptedCalls()).toHaveLength(1);

    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ id: 'orphan2', status: PLAYING })],
      is_accepting: true,
    });
    await fireRole({ isLeader: true, shouldRecover: true });
    expect(acceptedCalls()).toHaveLength(2);
    expect(socket.ackCalls).toBe(2);
  });

  it('구버전 preload는 세션 marker로 한 번만 복구한다', async () => {
    // isRecActive가 없으면 실제 재생 모드를 알 수 없다. 이때만 marker로
    // "이 실행 세션은 이미 복구했다"를 판단해 renderer reload마다 되돌리는 것을 막는다.
    const legacy = electronStub();
    delete legacy.isRecActive;
    window.electronAPI = legacy;
    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ id: 'orphan', status: PLAYING })],
      is_accepting: true,
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await fireRole({ isLeader: true, shouldRecover: true });
    expect(acceptedCalls()).toHaveLength(1);

    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ id: 'orphan2', status: PLAYING })],
      is_accepting: true,
    });
    await fireRole({ isLeader: true, shouldRecover: true });
    expect(acceptedCalls()).toHaveLength(1); // marker 덕분에 다시 되돌리지 않는다
    expect(socket.ackCalls).toBe(2); // ACK는 매번 보낸다
  });
});

describe('ACK 실패와 재시도', () => {
  it('ACK가 실패하면 복구 완료로 처리하지 않고 재시도를 예약한다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      socket.ackResult = { error: new Error('timeout'), response: null };
      api.getRecommendations.mockResolvedValue({
        recommendations: [rec({ id: 'orphan', status: PLAYING })],
        is_accepting: true,
      });
      const { result } = mount();
      await waitFor(() => expect(result.current.loading).toBe(false));
      socket.emit.mockClear();

      await fireRole({ isLeader: true, shouldRecover: true });
      expect(socket.ackCalls).toBe(1);

      await act(async () => {
        vi.advanceTimersByTime(2100);
        await Promise.resolve();
      });
      expect(socket.emit).toHaveBeenCalledWith('request_playback_role');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ACK만 유실됐다면 다음 역할 통보에서 이어서 마무리한다', async () => {
    // 서버는 복구를 받았는데 응답 패킷만 잃은 경우다. 이미 만든 snapshot으로
    // 이어가지 않으면 대기 곡이 영영 시작되지 않는다.
    api.getMe.mockResolvedValue({ music_filter_enabled: true });
    socket.ackResult = { error: new Error('timeout'), response: null };
    api.getRecommendations.mockResolvedValue({
      recommendations: [rec({ id: 'orphan', status: PLAYING })],
      is_accepting: true,
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.aiFilterReady).toBe(true));

    await fireRole({ isLeader: true, shouldRecover: true });
    expect(window.electronAPI.playRec).not.toHaveBeenCalled();

    // 서버는 이미 복구를 반영해 shouldRecover=false로 알려온다
    await fireRole({ isLeader: true, shouldRecover: false });

    await waitFor(() => expect(window.electronAPI.playRec).toHaveBeenCalled());
  });
});

describe('중복 실행 방지', () => {
  it('복구가 진행 중이면 두 번째 통보를 무시한다', async () => {
    // 두 번 돌면 같은 곡을 두 번 accepted로 되돌리고 ACK도 중복으로 나간다.
    let releaseFetch;
    const gate = new Promise(resolve => { releaseFetch = resolve; });
    let fetchCount = 0;
    api.getRecommendations.mockImplementation(async () => {
      fetchCount += 1;
      // 첫 복구의 조회만 붙잡아 그 사이에 두 번째 통보가 도착하게 한다
      if (fetchCount === 2) await gate;
      return { recommendations: [rec({ id: 'orphan', status: PLAYING })], is_accepting: true };
    });

    const { result } = mount();
    await waitFor(() => expect(result.current.recommendations).toHaveLength(1));

    act(() => { socket.fire('playback_role', { isLeader: true, shouldRecover: true }); });
    await fireRole({ isLeader: true, shouldRecover: true });

    await act(async () => {
      releaseFetch();
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    expect(acceptedCalls()).toHaveLength(1);
  });
});
