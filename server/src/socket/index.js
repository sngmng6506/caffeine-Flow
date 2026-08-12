const db = require('../db/knex');
const jwt = require('jsonwebtoken');
const { kstTodayString } = require('../utils/kst');
const { isUuid } = require('../utils/validate');
const { HEARTBEAT_REFRESH_MS, PLAYBACK_STATE_TTL_MS } = require('../constants/time-policy');
const { PLAYBACK_STATE, PLAYBACK_STATES } = require('../constants/playback-state');
const cafeService = require('../services/cafe.service');

const JWT_SECRET = (process.env.JWT_SECRET || '').trim();

// role=owner는 handshake query만으로 신뢰할 수 없음 (손님이 위조해서
// 붙으면 peak concurrent 통계에서 자기 자신을 owner로 차감시켜 왜곡 가능).
// auth.token의 JWT를 검증하고 slug 일치까지 확인 — 실패 시 손님으로 취급.
async function verifyOwner(socket, slug) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return null;
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.cafeId || !payload.slug || payload.pending || payload.slug !== slug) return null;
    const cafe = await cafeService.findById(payload.cafeId);
    return cafe?.slug === slug ? payload : null; // truthy payload = 인증 성공
  } catch {
    return null;
  }
}

// 매장 생존 신호 — verifyOwner를 통과한 owner 연결에서만 호출한다.
// 손님이 role=owner로 위조해 붙어도 여기 도달하지 못하므로, 꺼진 매장이
// 켜져 있는 것처럼 보여 광고 재고·모니터링이 왜곡되는 일은 없다.
// cafeId 기준으로 갱신한다 — slug는 QR 재발급으로 바뀔 수 있어(AGENTS
// 불변식), 연결 시점 slug로 계속 update하면 변경 후 0행 갱신이 된다.
async function touchHeartbeat(cafeId) {
  try {
    await db('cafes').where({ id: cafeId }).update({ last_heartbeat_at: db.fn.now() });
  } catch {
    // 하트비트 실패는 서비스 동작에 영향 없음 — 통계와 동일하게 무시
  }
}

function initSocket(io) {
  const cafeNsp = io.of('/cafe');

  // slug별 사장님 소켓 ID 집합 — peak concurrent에서 차감
  const ownerSockets = new Map(); // slug -> Set<socketId>
  const playbackPublishers = new Map(); // slug -> { socketId, timer, payload }

  function clearPlaybackState(slug, socketId = null) {
    const current = playbackPublishers.get(slug);
    if (!current || (socketId && current.socketId !== socketId)) return;
    clearTimeout(current.timer);
    playbackPublishers.delete(slug);
    cafeNsp.to(slug).emit('playback_state', {
      state: PLAYBACK_STATE.UNKNOWN,
      recommendationId: null,
    });
  }

  cafeNsp.on('connection', async (socket) => {
    const { slug, role } = socket.handshake.query;
    if (!slug) return socket.disconnect();

    const ownerPayload = role === 'owner' ? await verifyOwner(socket, slug) : null;

    // 손님은 정지·미존재 카페 room에 붙지 못하게 막는다 — HTTP findActiveBySlug와
    // 동일 경계. 붙게 두면 정지 카페의 큐 변경 브로드캐스트를 엿볼 수 있다.
    // 검증된 사장님은 오조치 복구를 위해 정지 중에도 접속 가능해야 하므로 예외.
    if (!ownerPayload) {
      let active;
      try {
        active = await cafeService.findActiveBySlug(slug);
      } catch {
        return socket.disconnect(); // 조회 실패 시 fail-closed — 손님 입장 거부
      }
      if (!active) return socket.disconnect();
    }

    socket.join(slug);
    const currentPlayback = playbackPublishers.get(slug);
    if (currentPlayback) socket.emit('playback_state', currentPlayback.payload);

    // 연결 유지 중 주기 갱신 타이머 — disconnect에서 반드시 해제(누수 방지)
    let heartbeatTimer = null;

    if (ownerPayload) {
      if (!ownerSockets.has(slug)) ownerSockets.set(slug, new Set());
      ownerSockets.get(slug).add(socket.id);

      // 매장이 지금 켜져 있음 — 연결 즉시 + 주기적으로 갱신.
      // owner 앱 코드 변경 없이 기존 소켓 연결을 그대로 생존 신호로 쓴다.
      touchHeartbeat(ownerPayload.cafeId);
      heartbeatTimer = setInterval(() => touchHeartbeat(ownerPayload.cafeId), HEARTBEAT_REFRESH_MS);

      socket.on('playback_state', (payload = {}) => {
        if (!PLAYBACK_STATES.includes(payload.state)) return;
        const recommendationId = isUuid(payload.recommendationId)
          ? payload.recommendationId
          : null;

        const previous = playbackPublishers.get(slug);
        if (previous) clearTimeout(previous.timer);
        const timer = setTimeout(() => clearPlaybackState(slug, socket.id), PLAYBACK_STATE_TTL_MS);
        const nextPlayback = {
          state: payload.state,
          recommendationId,
        };
        playbackPublishers.set(slug, { socketId: socket.id, timer, payload: nextPlayback });
        cafeNsp.to(slug).emit('playback_state', nextPlayback);
      });
    } else {
      // 손님 입장 시에만 피크 갱신 의미가 있음
      updatePeakConcurrent(cafeNsp, slug, ownerSockets);
    }

    socket.on('disconnect', () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      clearPlaybackState(slug, socket.id);
      ownerSockets.get(slug)?.delete(socket.id);
      if (ownerSockets.get(slug)?.size === 0) ownerSockets.delete(slug);
    });
  });
}

async function updatePeakConcurrent(nsp, slug, ownerSockets) {
  try {
    const room = nsp.adapter.rooms.get(slug);
    const total = room ? room.size : 0;
    const owners = ownerSockets.get(slug)?.size || 0;
    const customers = total - owners;
    if (customers < 1) return;

    const cafeService = require('../services/cafe.service');
    const cafe = await cafeService.findBySlug(slug);
    if (!cafe) return;

    // 방문/이력 통계와 동일하게 KST 기준 날짜 사용 (UTC면 오전 9시 전 피크가 전날로 기록됨)
    const today = kstTodayString();
    const existing = await db('daily_stats')
      .where({ cafe_id: cafe.id, date: today })
      .first();

    if (existing) {
      if (customers > (existing.peak_concurrent || 0)) {
        await db('daily_stats')
          .where({ id: existing.id })
          .update({ peak_concurrent: customers });
      }
    } else {
      await db('daily_stats')
        .insert({ cafe_id: cafe.id, date: today, peak_concurrent: customers })
        .onConflict(['cafe_id', 'date'])
        .merge({ peak_concurrent: customers });
    }
  } catch (err) {
    // 통계 실패는 무시
  }
}

module.exports = initSocket;
