const db = require('../db/knex');

function initSocket(io) {
  const cafeNsp = io.of('/cafe');

  cafeNsp.on('connection', (socket) => {
    const slug = socket.handshake.query.slug;
    if (!slug) return socket.disconnect();

    socket.join(slug);
    updatePeakConcurrent(cafeNsp, slug);

    socket.on('disconnect', () => {
      // 접속자 감소 시에는 피크 갱신 불필요
    });
  });
}

async function updatePeakConcurrent(nsp, slug) {
  try {
    const room = nsp.adapter.rooms.get(slug);
    const count = room ? room.size : 0;
    if (count <= 1) return; // 사장님 1명만 접속한 경우 무시

    const cafeService = require('../services/cafe.service');
    const cafe = await cafeService.findBySlug(slug);
    if (!cafe) return;

    const today = new Date().toISOString().slice(0, 10);
    const existing = await db('daily_stats')
      .where({ cafe_id: cafe.id, date: today })
      .first();

    if (existing) {
      if (count > (existing.peak_concurrent || 0)) {
        await db('daily_stats')
          .where({ id: existing.id })
          .update({ peak_concurrent: count });
      }
    } else {
      await db('daily_stats')
        .insert({ cafe_id: cafe.id, date: today, peak_concurrent: count })
        .onConflict(['cafe_id', 'date'])
        .merge({ peak_concurrent: count });
    }
  } catch (err) {
    // 통계 실패는 무시
  }
}

module.exports = initSocket;
