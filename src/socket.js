const { CAFE_TOKEN } = require('./config');
const state = require('./state');
const queue = require('./queue');

// IP당 1분에 3곡 신청 제한
const requestCounts = new Map();

// 1분마다 만료된 엔트리 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of requestCounts) {
    if (now > entry.resetAt) requestCounts.delete(ip);
  }
}, 60000);

function isRateLimited(ip) {
  const now   = Date.now();
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
      queue:      state.queue,
      isSystemOn: state.isSystemOn,
      isPlaying:  state.isPlaying,
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

    socket.on('song_ended', ({ token }) => {
      if (token !== CAFE_TOKEN) return;
      const now = Date.now();
      const elapsed = now - state.lastSongEndedAt;
      if (elapsed < 2000) return;
      state.lastSongEndedAt = now;
      queue.songEnded();
    });
    socket.on('admin_skip',   ({ token })     => { if (token === CAFE_TOKEN) queue.skip(); });
    socket.on('admin_delete', ({ token, id }) => { if (token === CAFE_TOKEN) queue.deleteSong(id); });
    socket.on('admin_clear',  ({ token })     => { if (token === CAFE_TOKEN) queue.clearQueue(); });
    socket.on('admin_toggle', ({ token })     => { if (token === CAFE_TOKEN) queue.toggleSystem(); });
  });
}

module.exports = initSocket;
