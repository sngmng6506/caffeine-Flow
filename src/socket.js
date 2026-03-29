const { CAFE_TOKEN } = require('./config');
const state = require('./state');
const queue = require('./queue');

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
      queue.addSong(song);
    });

    socket.on('admin_skip',   ({ token })     => { if (token === CAFE_TOKEN) queue.skip(); });
    socket.on('admin_delete', ({ token, id }) => { if (token === CAFE_TOKEN) queue.deleteSong(id); });
    socket.on('admin_toggle', ({ token })     => { if (token === CAFE_TOKEN) queue.toggleSystem(); });
  });
}

module.exports = initSocket;
