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
    expect(registry.needsRecovery('cafe', 'socket-a')).toBe(true);
    expect(registry.completeRecovery('cafe', 'socket-b')).toBe(false);
    expect(registry.needsRecovery('cafe', 'socket-a')).toBe(true);
    expect(registry.completeRecovery('cafe', 'socket-a')).toBe(true);
    expect(registry.needsRecovery('cafe', 'socket-a')).toBe(false);
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
    expect(registry.needsRecovery('cafe', 'socket-a2')).toBe(true);

    registry.remove('cafe', 'socket-a2');
    vi.advanceTimersByTime(1000);
    expect(registry.isLeader('cafe', 'socket-b')).toBe(true);
    expect(registry.needsRecovery('cafe', 'socket-b')).toBe(true);
    registry.clear();
  });

  it('복구 완료 ACK 전에는 같은 리더가 계속 복구를 재시도할 수 있다', () => {
    const registry = createPlaybackLeaderRegistry({ graceMs: 1000, onRoleChange: () => {} });
    registry.add('cafe', 'socket-a', 'session-a');

    expect(registry.needsRecovery('cafe', 'socket-a')).toBe(true);
    expect(registry.needsRecovery('cafe', 'socket-a')).toBe(true);
    expect(registry.completeRecovery('cafe', 'socket-a')).toBe(true);
    expect(registry.completeRecovery('cafe', 'socket-a')).toBe(false);
    registry.clear();
  });

  it('로그아웃 뒤 새 실행 세션은 lease 만료 후 복구가 필요한 리더가 된다', () => {
    vi.useFakeTimers();
    const registry = createPlaybackLeaderRegistry({ graceMs: 1000, onRoleChange: () => {} });
    registry.add('cafe', 'socket-a', 'session-a');
    registry.completeRecovery('cafe', 'socket-a');
    registry.remove('cafe', 'socket-a');

    expect(registry.add('cafe', 'socket-b', 'session-b')).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(registry.isLeader('cafe', 'socket-b')).toBe(true);
    expect(registry.needsRecovery('cafe', 'socket-b')).toBe(true);
    registry.clear();
  });
});
