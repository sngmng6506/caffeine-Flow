const state   = require('./state');
const history = require('./history');

let _broadcast = null;

function setBroadcast(fn) { _broadcast = fn; }

function broadcastQueue() {
  _broadcast?.({
    queue:      state.queue,
    isSystemOn: state.isSystemOn,
    isPlaying:  state.isPlaying,
  });
}

function playNext() {
  if (!state.queue.length) return;
  state.isPlaying = true;
  console.log(`[재생] ${state.queue[0].title}`);
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
  state.isPlaying = false;
  const song = state.queue.shift();
  if (song) { history.addEntry(song, { skipped: true }); console.log(`[스킵] ${song.title}`); }
  if (state.queue.length) playNext();
  else broadcastQueue();
}

function deleteSong(id) {
  const isFirst = state.queue[0]?.id === id && state.isPlaying;
  if (isFirst) {
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
  if (state.queue.length) playNext();
  else broadcastQueue();
}

function clearQueue() {
  for (const song of state.queue) {
    history.addEntry(song, { skipped: true });
  }
  state.queue = [];
  state.isPlaying = false;
  console.log(`[전체취소] 대기열 비움`);
  broadcastQueue();
}

function toggleSystem() {
  state.isSystemOn = !state.isSystemOn;
  console.log(`[시스템] ${state.isSystemOn ? 'ON' : 'OFF'}`);
  broadcastQueue();
}

module.exports = { setBroadcast, addSong, skip, deleteSong, songEnded, clearQueue, toggleSystem };
