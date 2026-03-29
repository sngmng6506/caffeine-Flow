const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../data/history.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}

function save(history) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(history, null, 2));
}

function addEntry(song, { skipped = false } = {}) {
  const history = load();
  history.unshift({ ...song, playedAt: new Date().toISOString(), skipped });
  if (history.length > 1000) history.splice(1000); // 최대 1000개 보존
  save(history);
}

function getHistory(limit = 50) {
  return load().slice(0, limit);
}

function getStats() {
  const history = load();
  const played  = history.filter((h) => !h.skipped);

  // 가장 많이 신청된 곡 TOP 10
  const countMap = {};
  for (const item of played) {
    if (!countMap[item.videoId]) countMap[item.videoId] = { ...item, count: 0 };
    countMap[item.videoId].count++;
  }
  const topSongs = Object.values(countMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 시간대별 재생 수
  const byHour = Array(24).fill(0);
  for (const item of played) {
    byHour[new Date(item.playedAt).getHours()]++;
  }

  return {
    total:    history.length,
    played:   played.length,
    skipped:  history.length - played.length,
    skipRate: history.length
      ? Math.round(((history.length - played.length) / history.length) * 100)
      : 0,
    topSongs,
    byHour,
  };
}

module.exports = { addEntry, getHistory, getStats };
