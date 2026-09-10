const { renderPrompt } = require('./prompt.renderer');

function compact(value, fallback = '') {
  return String(value || fallback).trim();
}

const DEFAULT_CAFE_PROMPT = '이 매장의 분위기를 해치지 않는 곡만 허용합니다.';

function resolveCafePrompt(cafePrompt) {
  return compact(cafePrompt, DEFAULT_CAFE_PROMPT);
}

function buildMusicFilterMessages({ cafePrompt, track }) {
  const storePrompt = resolveCafePrompt(cafePrompt);

  return [
    { role: 'system', content: renderPrompt('music-filter.system.njk') },
    { role: 'user', content: renderPrompt('music-filter.user.njk', {
      cafe_policy: storePrompt,
      platform: compact(track.platform, 'unknown'),
      title: compact(track.title, 'unknown'),
      channel_title: compact(track.channelTitle, 'unknown'),
      duration: compact(track.duration, 'unknown'),
    }) },
  ];
}

module.exports = { buildMusicFilterMessages, resolveCafePrompt };
