const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../data/history.json');

// 인메모리 캐시 - 서버 실행 중 파일 I/O 최소화
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { cache = []; }
  return cache;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
}

function addEntry(song, { skipped = false } = {}) {
  load();
  cache.unshift({ ...song, playedAt: new Date().toISOString(), skipped });
  if (cache.length > 1000) cache.splice(1000);
  save();
}

function getHistory(limit = 50) {
  return load().slice(0, limit);
}

function getStats() {
  const history = load();
  const played  = history.filter((h) => !h.skipped);

  const countMap = {};
  for (const item of played) {
    if (!countMap[item.videoId]) countMap[item.videoId] = { ...item, count: 0 };
    countMap[item.videoId].count++;
  }
  const topSongs = Object.values(countMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

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

function getStatsByDate(dateStr) {
  const history = load();
  const filtered = history.filter((h) => h.playedAt && h.playedAt.startsWith(dateStr));
  const played = filtered.filter((h) => !h.skipped);

  const byHour = Array(24).fill(null).map(() => []);
  for (const item of filtered) {
    const hour = new Date(item.playedAt).getHours();
    byHour[hour].push({
      videoId:      item.videoId,
      title:        item.title,
      channelTitle: item.channelTitle,
      thumbnail:    item.thumbnail,
      playedAt:     item.playedAt,
      skipped:      item.skipped,
    });
  }

  const dates = [...new Set(history.map((h) => h.playedAt?.slice(0, 10)).filter(Boolean))].sort().reverse();

  return {
    date:    dateStr,
    total:   filtered.length,
    played:  played.length,
    skipped: filtered.length - played.length,
    byHour,
    dates,
  };
}

module.exports = { addEntry, getHistory, getStats, getStatsByDate };
