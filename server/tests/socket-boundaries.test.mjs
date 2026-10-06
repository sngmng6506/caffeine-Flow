import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import jwt from 'jsonwebtoken';

const moduleUrl = new URL('../src/socket/index.js', import.meta.url);
const require = createRequire(moduleUrl);
const { cafeRoom, ownerRoom, disconnectCafe } = require('./rooms');
const { broadcastRecommendation } = require('../routes/_recommendations.shared');
const cafeId = '11111111-1111-4111-8111-111111111111';

// 네트워크·DB만 대체하고 실제 이벤트 핸들러·JWT·리더 registry를 실행한다.
function harness() {
  let cafe = { id: cafeId, slug: 'before', is_suspended: false };
  const db = () => ({ where() { return this; }, update: async () => 1 });
  db.fn = { now: () => new Date() };
  const service = {
    isValidSlugFormat: value => /^[a-z0-9]{4,20}$/.test(value),
    findById: vi.fn(async () => ({ ...cafe })),
    findActiveBySlug: vi.fn(async slug => slug === cafe.slug ? { ...cafe } : null),
    touchHeartbeat: vi.fn(async () => {}),
  };
  let connect;
  const sockets = new Map();
  const nsp = {
    sockets,
    in: room => ({ disconnectSockets() {
      for (const socket of sockets.values()) if (socket.rooms.has(room)) socket.disconnect();
    } }),
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

describe('사장님 앱 생존 신호', () => {
  // 운영자 콘솔의 "영업 중" 표시가 last_heartbeat_at으로 정해진다. 갱신이 멈추면
  // 켜져 있는 매장이 꺼진 것으로 보인다.
  it('사장님 연결은 카페 ID로 하트비트를 남기고 주기적으로 갱신한다', async () => {
    const { open, service } = harness();
    await open();
    expect(service.touchHeartbeat).toHaveBeenCalledWith(cafeId);
    const calls = service.touchHeartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(service.touchHeartbeat.mock.calls.length).toBeGreaterThan(calls);
  });

  it('손님 연결은 하트비트를 남기지 않는다', async () => {
    const { open, service } = harness();
    await open({ id: 'customer', owner: false });
    expect(service.touchHeartbeat).not.toHaveBeenCalled();
  });

  it('하트비트 저장이 실패해도 연결을 끊지 않는다', async () => {
    const { open, service } = harness();
    service.touchHeartbeat.mockRejectedValue(new Error('db down'));
    const { socket } = await open();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.connected).toBe(true);
  });
});

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


describe('주소 변경·재사용 소켓 경계', () => {
  it('다른 카페가 주소를 재사용해도 이전 연결에 비공개 이벤트나 재생 상태가 넘어가지 않는다', async () => {
    const h = harness();
    const old = await h.open();
    const other = { id: '33333333-3333-4333-8333-333333333333', slug: 'before' };
    h.change(other);
    const next = await h.open({ id: 'next' });
    old.socket.emit.mockClear();
    next.socket.emit.mockClear();
    const req = { app: { get: () => h.io } };
    broadcastRecommendation(req, other, { action: 'add', rec: { title: '다른 매장', filter_reason: '비공개' } });
    expect(old.socket.emit).not.toHaveBeenCalled();
    expect(next.socket.emit).toHaveBeenCalledWith('owner_recommendations_update', expect.objectContaining({ rec: expect.objectContaining({ filter_reason: '비공개' }) }));
    next.socket.emit.mockClear();
    old.handlers.playback_state({ state: 'playing' });
    expect(next.socket.emit).not.toHaveBeenCalled();
  });

  it('주소 변경은 기존 손님·사장님을 끊고 재생 발행 권한을 회수한다', async () => {
    const h = harness();
    const oldCafe = { id: cafeId, slug: 'before' };
    const old = await h.open();
    const guest = await h.open({ id: 'guest', owner: false });
    expect(old.socket.rooms.has(ownerRoom(oldCafe))).toBe(true);
    h.change({ slug: 'after' });
    disconnectCafe(h.io, oldCafe);
    expect(old.socket.connected).toBe(false);
    expect(guest.socket.connected).toBe(false);
    old.socket.emit.mockClear();
    old.handlers.playback_state({ state: 'playing' });
    expect(old.socket.emit).not.toHaveBeenCalled();
    const next = await h.open({ id: 'next' });
    expect(next.socket.rooms.has(cafeRoom({ id: cafeId, slug: 'after' }))).toBe(true);
    expect(next.socket.emit).toHaveBeenCalledWith('playback_role', { isLeader: true });
  });

  it('최초 인증 직후 주소가 바뀐 연결은 join 이후 재검증에서 끊는다', async () => {
    const h = harness();
    h.service.findById.mockResolvedValueOnce({ id: cafeId, slug: 'before' })
      .mockResolvedValueOnce({ id: cafeId, slug: 'after' });
    const { socket, handlers } = await h.open();
    expect(socket.connected).toBe(false);
    expect(socket.rooms.size).toBe(0);
    expect(handlers.playback_state).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('실제 주소 변경 라우트가 이동 안내 후 이전 room을 종료한다', async () => {
  const h = harness();
  const old = await h.open();
  const routeUrl = new URL('../src/routes/cafes.js', import.meta.url);
  const routeRequire = createRequire(routeUrl);
  const handlers = new Map();
  const router = {};
  for (const method of ['get', 'post', 'put', 'delete']) {
    router[method] = (path, ...callbacks) => { handlers.set(`${method} ${path}`, callbacks.at(-1)); };
  }
  const service = {
    isValidSlugFormat: () => true,
    changeSlug: async (_, slug) => { h.change({ slug }); return { id: cafeId, slug }; },
    findInitialSlug: async () => 'before',
  };
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(routeUrl, 'utf8'), {
    module,
    require: name => name === 'express' ? { Router: () => router }
      : name === '../services/cafe.service' ? service : routeRequire(name),
    process,
  });
  const json = vi.fn();
  await handlers.get('put /me/slug')({
    body: { slug: 'after' }, owner: { cafeId, slug: 'before' }, cafe: { id: cafeId, slug: 'before' },
    app: { get: () => h.io },
  }, { json });
  expect(old.socket.emit).toHaveBeenCalledWith('cafe_moved', { movedTo: 'after' });
  expect(old.socket.connected).toBe(false);
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ slug: 'after', token: expect.any(String) }));
});
