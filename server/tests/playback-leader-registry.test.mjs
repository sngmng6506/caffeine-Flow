import { afterEach, describe, expect, it, vi } from 'vitest';
import registryModule from '../src/socket/playback-leader-registry.js';

const { createPlaybackLeaderRegistry } = registryModule;

afterEach(() => vi.useRealTimers());

function make({ graceMs = 1000 } = {}) {
  const roles = new Map();
  const superseded = [];
  const registry = createPlaybackLeaderRegistry({
    graceMs,
    onRoleChange: (id, isLeader) => roles.set(id, isLeader),
    onSuperseded: (id) => superseded.push(id),
  });
  return { registry, roles, superseded };
}

describe('playback leader registry', () => {
  it('나중에 들어온 실행 세션이 리더를 넘겨받는다', () => {
    // 매장에서 실제로 소리를 내는 앱은 하나여야 한다. 리더가 아닌 Electron을
    // 띄워 둘 이유가 없으므로 최근 로그인 쪽으로 넘긴다.
    const { registry, roles, superseded } = make();

    expect(registry.add('cafe', 'socket-a', 'session-a')).toBe(true);
    expect(registry.add('cafe', 'socket-b', 'session-b')).toBe(true);

    expect(registry.isLeader('cafe', 'socket-b')).toBe(true);
    expect(registry.isLeader('cafe', 'socket-a')).toBe(false);
    expect(roles.get('socket-a')).toBe(false);
    // 이전 리더는 스스로 종료해야 한다. 역할만 내리면 계속 소리를 낸다.
    expect(superseded).toEqual(['socket-a']);
    registry.clear();
  });

  it('넘겨받은 리더는 고아 playing을 복구해야 한다', () => {
    const { registry } = make();
    registry.add('cafe', 'socket-a', 'session-a');
    registry.completeRecovery('cafe', 'socket-a');

    registry.add('cafe', 'socket-b', 'session-b');

    expect(registry.needsRecovery('cafe', 'socket-b')).toBe(true);
    expect(registry.completeRecovery('cafe', 'socket-a')).toBe(false);
    registry.clear();
  });

  it('같은 세션 재연결은 lease를 되찾고 아무에게도 알리지 않는다', () => {
    // renderer reload와 짧은 network 단절은 sessionStorage가 살아 있어 같은 ID로
    // 돌아온다. 이때 종료를 알리면 멀쩡한 앱이 닫힌다.
    vi.useFakeTimers();
    const { registry, superseded } = make();
    registry.add('cafe', 'socket-a', 'session-a');
    registry.remove('cafe', 'socket-a');

    expect(registry.add('cafe', 'socket-a2', 'session-a')).toBe(true);
    expect(registry.needsRecovery('cafe', 'socket-a2')).toBe(true);
    expect(superseded).toEqual([]);
    registry.clear();
  });

  it('리더가 사라진 뒤 붙은 다른 세션은 기다리지 않고 승격된다', () => {
    vi.useFakeTimers();
    const { registry, superseded } = make();
    registry.add('cafe', 'socket-a', 'session-a');
    registry.remove('cafe', 'socket-a');

    expect(registry.add('cafe', 'socket-b', 'session-b')).toBe(true);
    expect(registry.needsRecovery('cafe', 'socket-b')).toBe(true);
    // 이미 끊긴 소켓에는 종료를 알리지 않는다.
    expect(superseded).toEqual([]);

    // 유예 타이머가 살아남아 새 리더를 지우면 안 된다.
    vi.advanceTimersByTime(1000);
    expect(registry.isLeader('cafe', 'socket-b')).toBe(true);
    registry.clear();
  });

  it('복구 완료 ACK 전에는 같은 리더가 계속 복구를 재시도할 수 있다', () => {
    const { registry } = make();
    registry.add('cafe', 'socket-a', 'session-a');

    expect(registry.needsRecovery('cafe', 'socket-a')).toBe(true);
    expect(registry.needsRecovery('cafe', 'socket-a')).toBe(true);
    expect(registry.completeRecovery('cafe', 'socket-a')).toBe(true);
    expect(registry.completeRecovery('cafe', 'socket-a')).toBe(false);
    registry.clear();
  });
});
