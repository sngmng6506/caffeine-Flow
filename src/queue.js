const WebSocket = require('ws');
const state   = require('./state');
const history = require('./history');

let _broadcast = null;

function setBroadcast(fn) { _broadcast = fn; }

function broadcastQueue() {
  _broadcast?.({
    queue:             state.queue,
    isSystemOn:        state.isSystemOn,
    isPlaying:         state.isPlaying,
    extensionConnected: !!state.extensionWs,
  });
}

function playNext() {
  const { extensionWs, queue } = state;
  if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN || !queue.length) return;

  state.isPlaying = true;
  extensionWs.send(JSON.stringify({ type: 'play_song', song: queue[0] }));
  console.log(`[재생] ${queue[0].title}`);
  broadcastQueue();
}

function addSong(song) {
  const item = { id: Date.now().toString(), ...song, requestedAt: new Date().toISOString() };
  state.queue.push(item);
  console.log(`[신청] ${song.title}`);
  if (!state.isPlaying) playNext();
  else broadcastQueue();
}

function skip() {
  if (state.extensionWs && state.isPlaying)
    state.extensionWs.send(JSON.stringify({ type: 'stop_song' }));

  state.isPlaying = false;
  const song = state.queue.shift();
  if (song) { history.addEntry(song, { skipped: true }); console.log(`[스킵] ${song.title}`); }

  if (state.queue.length) playNext();
  else broadcastQueue();
}

function deleteSong(id) {
  const isCurrentlyPlaying = state.queue[0]?.id === id && state.isPlaying;

  if (isCurrentlyPlaying) {
    state.extensionWs?.send(JSON.stringify({ type: 'stop_song' }));
    state.isPlaying = false;
    const song = state.queue.shift();
    if (song) history.addEntry(song, { skipped: true });
    if (state.queue.length) playNext();
    else broadcastQueue();
  } else {
    state.queue = state.queue.filter((item) => item.id !== id);
    broadcastQueue();
  }
  console.log(`[삭제] id=${id}`);
}

function songEnded() {
  state.isPlaying = false;
  const song = state.queue.shift();
  if (song) { history.addEntry(song, { skipped: false }); console.log(`[종료] ${song.title}`); }

  broadcastQueue();
  if (state.queue.length) playNext();
}

function toggleSystem() {
  state.isSystemOn = !state.isSystemOn;
  console.log(`[시스템] ${state.isSystemOn ? 'ON' : 'OFF'}`);
  broadcastQueue();
}

module.exports = { setBroadcast, broadcastQueue, playNext, addSong, skip, deleteSong, songEnded, toggleSystem };
