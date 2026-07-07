const db = require('../db/knex');
const jwt = require('jsonwebtoken');
const { kstTodayString } = require('../utils/kst');

const JWT_SECRET = (process.env.JWT_SECRET || '').trim();

// role=owner는 handshake query만으로 신뢰할 수 없음 (손님이 위조해서
// 붙으면 peak concurrent 통계에서 자기 자신을 owner로 차감시켜 왜곡 가능).
// auth.token의 JWT를 검증하고 slug 일치까지 확인 — 실패 시 손님으로 취급.
function verifyOwner(socket, slug) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return false;
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.slug === slug;
  } catch {
    return false;
  }
}

function initSocket(io) {
  const cafeNsp = io.of('/cafe');

  // slug별 사장님 소켓 ID 집합 — peak concurrent에서 차감
  const ownerSockets = new Map(); // slug -> Set<socketId>

  cafeNsp.on('connection', (socket) => {
    const { slug, role } = socket.handshake.query;
    if (!slug) return socket.disconnect();

    socket.join(slug);

    if (role === 'owner' && verifyOwner(socket, slug)) {
      if (!ownerSockets.has(slug)) ownerSockets.set(slug, new Set());
      ownerSockets.get(slug).add(socket.id);
    } else {
      // 손님 입장 시에만 피크 갱신 의미가 있음
      updatePeakConcurrent(cafeNsp, slug, ownerSockets);
    }

    socket.on('disconnect', () => {
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
