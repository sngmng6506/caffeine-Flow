// 재생 세션 ID는 handshake query로만 서버에 전달된다. ID 없이 만들어진 소켓이
// 캐시되면 서버가 재생 후보로 등록하지 않아(socket/index.js) 그 Electron은 영영
// follower가 되고, 재연결해도 같은 query를 다시 보내 스스로 회복하지 못한다.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const connections = [];

vi.mock('socket.io-client', () => ({
  io: (url, options) => {
    const handlers = new Map();
    const instance = {
      url,
      options,
      connected: true,
      on: (event, fn) => handlers.set(event, fn),
      off: (event) => handlers.delete(event),
      disconnect: vi.fn(() => { instance.connected = false; }),
    };
    connections.push(instance);
    return instance;
  },
}));

const sessionIdOf = (instance) => instance.options.query.playbackSessionId;

describe('사장님 소켓 연결', () => {
  beforeEach(async () => {
    connections.length = 0;
    vi.resetModules();
    window.sessionStorage.clear();
    window.localStorage.clear();
    delete window.electronAPI;
  });

  it('브라우저에서는 재생 세션 ID를 보내지 않는다', async () => {
    const { getSocket } = await import('./socket.js');
    getSocket('test');

    expect(connections).toHaveLength(1);
    expect(sessionIdOf(connections[0])).toBeUndefined();
  });

  it('preload 브리지가 늦게 붙으면 세션 ID를 실어 다시 연결한다', async () => {
    const { getSocket } = await import('./socket.js');
    // renderer가 브리지보다 먼저 떠서 ID 없이 한 번 연결된 상태
    const withoutBridge = getSocket('test');
    expect(sessionIdOf(withoutBridge)).toBeUndefined();

    window.electronAPI = { playRec: () => {} };
    const withBridge = getSocket('test');

    expect(withoutBridge.disconnect).toHaveBeenCalled();
    expect(withBridge).not.toBe(withoutBridge);
    expect(sessionIdOf(withBridge)).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('브리지가 있으면 같은 소켓을 그대로 쓴다', async () => {
    window.electronAPI = { playRec: () => {} };
    const { getSocket } = await import('./socket.js');
    const first = getSocket('test');
    const second = getSocket('test');

    expect(second).toBe(first);
    expect(connections).toHaveLength(1);
  });

  it('브리지가 사라져도 멀쩡한 연결을 끊지 않는다', async () => {
    window.electronAPI = { playRec: () => {} };
    const { getSocket } = await import('./socket.js');
    const first = getSocket('test');

    delete window.electronAPI;
    const second = getSocket('test');

    expect(second).toBe(first);
    expect(first.disconnect).not.toHaveBeenCalled();
  });
});
