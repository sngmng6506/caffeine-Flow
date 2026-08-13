import { afterEach, describe, expect, it, vi } from 'vitest';
import registryModule from '../src/socket/playback-leader-registry.js';

const { createPlaybackLeaderRegistry } = registryModule;

afterEach(() => vi.useRealTimers());

describe('playback leader registry', () => {
  it('첫 Electron만 리더가 되고 follower 상태는 분리된다', () => {
    const roles = new Map();
    const registry = createPlaybackLeaderRegistry({
      graceMs: 1000,
      onRoleChange: (id, isLeader) => roles.set(id, isLeader),
    });

    expect(registry.add('cafe', 'socket-a', 'session-a')).toBe(true);
    expect(registry.add('cafe', 'socket-b', 'session-b')).toBe(false);
    expect(registry.claimRecovery('cafe', 'socket-a')).toBe(true);
    expect(registry.claimRecovery('cafe', 'socket-a')).toBe(false);
    expect(roles.get('socket-a')).toBe(true);
    expect(roles.get('socket-b')).toBe(false);
    registry.clear();
  });

  it('같은 세션 재연결은 lease를 회수하고 다른 앱은 유예 뒤 승격된다', () => {
    vi.useFakeTimers();
    const registry = createPlaybackLeaderRegistry({ graceMs: 1000, onRoleChange: () => {} });
    registry.add('cafe', 'socket-a', 'session-a');
    registry.add('cafe', 'socket-b', 'session-b');

    registry.remove('cafe', 'socket-a');
    expect(registry.isLeader('cafe', 'socket-b')).toBe(false);
    expect(registry.add('cafe', 'socket-a2', 'session-a')).toBe(true);
    expect(registry.claimRecovery('cafe', 'socket-a2')).toBe(true);

    registry.remove('cafe', 'socket-a2');
    vi.advanceTimersByTime(1000);
    expect(registry.isLeader('cafe', 'socket-b')).toBe(true);
    registry.clear();
  });
});
