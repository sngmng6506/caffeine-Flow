const { CAFE_TOKEN } = require('./config');
const state = require('./state');
const queue = require('./queue');

// IP당 1분에 3곡 신청 제한
const requestCounts = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = requestCounts.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  requestCounts.set(ip, entry);
  return entry.count > 3;
}

function initSocket(io) {
  queue.setBroadcast((data) => io.emit('queue_update', data));

  io.on('connection', (socket) => {
    socket.emit('queue_update', {
      queue:             state.queue,
      isSystemOn:        state.isSystemOn,
      isPlaying:         state.isPlaying,
      extensionConnected: !!state.extensionWs,
    });

    socket.on('request_song', ({ token, song }) => {
      if (token !== CAFE_TOKEN || !state.isSystemOn) return;
      const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
      if (isRateLimited(ip)) {
        socket.emit('request_error', { error: '잠시 후 다시 신청해주세요 (1분에 3곡 제한)' });
        return;
      }
      queue.addSong(song);
    });

    socket.on('admin_skip',   ({ token })     => { if (token === CAFE_TOKEN) queue.skip(); });
    socket.on('admin_delete', ({ token, id }) => { if (token === CAFE_TOKEN) queue.deleteSong(id); });
    socket.on('admin_toggle', ({ token })     => { if (token === CAFE_TOKEN) queue.toggleSystem(); });
  });
}

module.exports = initSocket;
