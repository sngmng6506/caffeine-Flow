const jwt = require('jsonwebtoken');
const { isUuid } = require('../utils/validate');
const {
  HEARTBEAT_REFRESH_MS,
  PLAYBACK_STATE_TTL_MS,
  PLAYBACK_LEADER_GRACE_MS,
} = require('../constants/time-policy');
const { PLAYBACK_STATE, PLAYBACK_STATES } = require('../constants/playback-state');
const cafeService = require('../services/cafe.service');
const { cafeRoom, ownerRoom } = require('./rooms');
const { createPlaybackLeaderRegistry } = require('./playback-leader-registry');
const { sanitizePlaybackTrack } = require('./playback-payload');

const JWT_SECRET = (process.env.JWT_SECRET || '').trim();

// role=owner는 handshake query만으로 신뢰할 수 없음 (손님이 위조해서 붙으면
// 사장님 room의 AI 판단 상세를 받고 재생 리더 권한까지 얻는다).
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
    await cafeService.touchHeartbeat(cafeId);
  } catch {
    // 하트비트 실패는 서비스 동작에 영향 없음 — 통계와 동일하게 무시
  }
}

function initSocket(io) {
  const cafeNsp = io.of('/cafe');

  const playbackPublishers = new Map(); // room -> { socketId, timer, payload }
  const playbackLeaders = createPlaybackLeaderRegistry({
    graceMs: PLAYBACK_LEADER_GRACE_MS,
    onRoleChange: (socketId, isLeader) => {
      cafeNsp.sockets.get(socketId)?.emit('playback_role', { isLeader });
    },
    // 다른 기기에서 로그인해 재생을 넘겨받았다. 역할만 내려 두면 이전 앱이 계속
    // 소리를 내므로, 스스로 종료하라고 따로 알린다. 평범한 follower·브라우저는
    // 이 이벤트를 받지 않는다 — 리더였던 소켓에만 간다.
    onSuperseded: (socketId) => {
      cafeNsp.sockets.get(socketId)?.emit('playback_superseded');
    },
  });

  function clearPlaybackState(room, socketId = null) {
    const current = playbackPublishers.get(room);
    if (!current || (socketId && current.socketId !== socketId)) return;
    clearTimeout(current.timer);
    playbackPublishers.delete(room);
    cafeNsp.to(room).emit('playback_state', {
      state: PLAYBACK_STATE.UNKNOWN,
      recommendationId: null,
      track: null,
    });
  }

  cafeNsp.on('connection', async (socket) => {
    const { slug, role } = socket.handshake.query;
    if (typeof slug !== 'string' || !cafeService.isValidSlugFormat(slug)) return socket.disconnect();

    const ownerPayload = role === 'owner' ? await verifyOwner(socket, slug) : null;

    let cafe;
    try {
      cafe = ownerPayload
        ? { id: ownerPayload.cafeId, slug }
        : await cafeService.findActiveBySlug(slug);
      if (!cafe || !socket.connected) return socket.disconnect();
      const room = cafeRoom(cafe);
      await socket.join(room);
      if (ownerPayload) await socket.join(ownerRoom(cafe));
      // 인증 조회와 join 사이에 주소가 바뀌어 강제 종료를 놓친 연결도 막는다.
      // join 이후 검증하므로 검증 중 변경된 연결은 변경 라우트가 끊는다.
      const current = await cafeService.findById(cafe.id);
      if (!current || current.slug !== slug || (!ownerPayload && current.is_suspended)
          || !socket.connected) return socket.disconnect();
    } catch {
      return socket.disconnect();
    }
    const room = cafeRoom(cafe);
    const currentPlayback = playbackPublishers.get(room);
    if (currentPlayback) socket.emit('playback_state', currentPlayback.payload);

    // 연결 유지 중 주기 갱신 타이머 — disconnect에서 반드시 해제(누수 방지)
    let heartbeatTimer = null;

    if (ownerPayload) {
      // 매장이 지금 켜져 있음 — 연결 즉시 + 주기적으로 갱신.
      // owner 앱 코드 변경 없이 기존 소켓 연결을 그대로 생존 신호로 쓴다.
      touchHeartbeat(ownerPayload.cafeId);
      heartbeatTimer = setInterval(() => touchHeartbeat(ownerPayload.cafeId), HEARTBEAT_REFRESH_MS);

      const rawSessionId = socket.handshake.query.playbackSessionId;
      const playbackSessionId = typeof rawSessionId === 'string' && isUuid(rawSessionId)
        ? rawSessionId
        : null;
      if (playbackSessionId) playbackLeaders.add(room, socket.id, playbackSessionId);
      else socket.emit('playback_role', { isLeader: false });

      socket.on('request_playback_role', () => {
        const isLeader = !!playbackSessionId && playbackLeaders.isLeader(room, socket.id);
        socket.emit('playback_role', {
          isLeader,
          // 복구 권한은 renderer가 DB 복구를 끝내고 ACK할 때까지 유지한다.
          // 네트워크/API 오류로 복구가 중단돼도 다음 요청에서 재시도할 수 있다.
          shouldRecover: isLeader && playbackLeaders.needsRecovery(room, socket.id),
        });
      });

      socket.on('playback_recovery_complete', (ack) => {
        const ok = !!playbackSessionId && playbackLeaders.completeRecovery(room, socket.id);
        if (typeof ack === 'function') ack({ ok });
      });

      socket.on('playback_state', (payload = {}) => {
        // 인증된 사장님이라도 실제 재생을 맡은 Electron 한 대만 상태를
        // 발행한다. 브라우저나 follower가 손님 화면을 덮어쓰지 못한다.
        if (!playbackLeaders.isLeader(room, socket.id)) return;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
        if (!PLAYBACK_STATES.includes(payload.state)) return;
        const recommendationId = isUuid(payload.recommendationId)
          ? payload.recommendationId
          : null;

        const previous = playbackPublishers.get(room);
        if (previous) clearTimeout(previous.timer);
        const timer = setTimeout(() => clearPlaybackState(room, socket.id), PLAYBACK_STATE_TTL_MS);
        const nextPlayback = {
          state: payload.state,
          recommendationId,
          track: sanitizePlaybackTrack(payload.track),
        };
        playbackPublishers.set(room, { socketId: socket.id, timer, payload: nextPlayback });
        cafeNsp.to(room).emit('playback_state', nextPlayback);
      });
    }

    socket.on('disconnect', () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      clearPlaybackState(room, socket.id);
      playbackLeaders.remove(room, socket.id);
    });
  });
}

module.exports = initSocket;
