const WebSocket = require('ws');
const { CAFE_TOKEN } = require('./config');
const state = require('./state');
const queue = require('./queue');

function initExtension(server, io) {
  const wss = new WebSocket.Server({ server, path: '/extension' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('token') !== CAFE_TOKEN) {
      ws.close(1008, 'Invalid token');
      return;
    }

    state.extensionWs = ws;
    console.log('[익스텐션] 연결됨');
    io.emit('extension_status', { connected: true });

    if (state.queue.length && !state.isPlaying) queue.playNext();

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'song_ended') queue.songEnded();
      } catch {}
    });

    ws.on('close', () => {
      state.extensionWs = null;
      state.isPlaying   = false;
      console.log('[익스텐션] 연결 해제');
      io.emit('extension_status', { connected: false });
      queue.broadcastQueue();
    });
  });
}

module.exports = initExtension;
