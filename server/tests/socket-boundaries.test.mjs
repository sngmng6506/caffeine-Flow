import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import jwt from 'jsonwebtoken';

const moduleUrl = new URL('../src/socket/index.js', import.meta.url);
const require = createRequire(moduleUrl);
const cafeId = '11111111-1111-4111-8111-111111111111';

// 네트워크·DB만 대체하고 실제 이벤트 핸들러·JWT·리더 registry를 실행한다.
function harness() {
  let cafe = { id: cafeId, slug: 'before', is_suspended: false };
  const db = () => ({ where() { return this; }, update: async () => 1 });
  db.fn = { now: () => new Date() };
  const service = {
    findById: vi.fn(async () => ({ ...cafe })),
    findActiveBySlug: vi.fn(async slug => slug === cafe.slug ? { ...cafe } : null),
  };
  let connect;
  const sockets = new Map();
  const nsp = {
    sockets,
    on: (_, fn) => { connect = fn; },
    to: room => ({ emit(event, data) {
      for (const socket of sockets.values()) {
        if (socket.rooms.has(room)) socket.emit(event, data);
      }
    } }),
  };
  const io = { of: () => nsp };
  const module = { exports: {} };
  const localRequire = name => name === '../db/knex' ? db
    : name === '../services/cafe.service' ? service : require(name);
  vm.runInNewContext(readFileSync(moduleUrl, 'utf8'), {
    module, require: localRequire, process, setInterval, clearInterval, setTimeout, clearTimeout,
  });
  module.exports(io);
  async function open({ id = 'owner', slug = cafe.slug, owner = true } = {}) {
    const handlers = {};
    const socket = {
      id, connected: true, rooms: new Set(), emit: vi.fn(),
      handshake: { query: { slug, role: owner ? 'owner' : 'customer',
        playbackSessionId: '22222222-2222-4222-8222-222222222222' },
      auth: { token: owner ? jwt.sign({ cafeId: cafe.id, slug }, process.env.JWT_SECRET) : null } },
      on: (event, fn) => { handlers[event] = fn; },
      join: room => socket.rooms.add(room),
      disconnect() { socket.connected = false; socket.rooms.clear(); handlers.disconnect?.(); },
    };
    sockets.set(id, socket);
    await connect(socket);
    return { socket, handlers };
  }
  return { open, io, service, change: values => { cafe = { ...cafe, ...values }; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('재생 소켓 입력 경계', () => {
  it('기형 메시지는 무시하고 다음 정상 메시지를 처리한다', async () => {
    const { open } = harness();
    const { socket, handlers } = await open();
    socket.emit.mockClear();
    for (const payload of [null, undefined, false, 1, 'playing', [], {}, { state: 'invalid' }]) {
      expect(() => handlers.playback_state(payload)).not.toThrow();
    }
    expect(socket.emit).not.toHaveBeenCalled();
    handlers.playback_state({ state: 'playing' });
    expect(socket.emit).toHaveBeenCalledWith('playback_state', expect.objectContaining({ state: 'playing' }));
  });
});
