const cafeService = require('../services/cafe.service');
const recService  = require('../services/recommendation.service');

function safe(fn) {
  return async (...args) => {
    try { await fn(...args); } catch (err) { console.error('[socket]', err.message); }
  };
}

function initSocket(io) {
  const cafeNsp = io.of('/cafe');

  cafeNsp.on('connection', (socket) => {
    const slug = socket.handshake.query.slug;
    if (!slug) return socket.disconnect();

    socket.join(slug);

    socket.on('accept',      safe(({ id }) => updateAndBroadcast(cafeNsp, slug, id, 'accepted')));
    socket.on('reject',      safe(({ id }) => updateAndBroadcast(cafeNsp, slug, id, 'rejected')));
    socket.on('skip',        safe(({ id }) => updateAndBroadcast(cafeNsp, slug, id, 'skipped')));
    socket.on('now_playing', safe(({ id }) => updateAndBroadcast(cafeNsp, slug, id, 'playing')));

    socket.on('toggle_system', safe(async ({ is_accepting }) => {
      const cafe = await cafeService.findBySlug(slug);
      if (!cafe) return;
      await cafeService.update(cafe.id, { is_accepting });
      cafeNsp.to(slug).emit('system_toggled', { is_accepting });
    }));
  });
}

async function updateAndBroadcast(nsp, slug, id, status) {
  const rec = await recService.updateStatus(id, status);
  nsp.to(slug).emit('recommendations_update', { action: 'update', rec });
}

module.exports = initSocket;
