const { renderPrompt } = require('./prompt.renderer');

function compact(value, fallback = '') {
  return String(value || fallback).trim();
}

const DEFAULT_CAFE_PROMPT = '이 매장의 분위기를 해치지 않는 곡만 허용합니다.';

// V/A는 DEAM [1,9]를 [0,1]로 옮긴 보정된 값이라 숫자 자체가 뜻을 갖는다. 밴드 이름으로
// 뭉치면 0.601과 0.641이 똑같이 "중간"이 되므로, 숫자에 척도의 양 끝을 붙여 준다.
// 워커 audio_llm.py의 va_context(style='number')와 같은 형식이다.
function describeScale(value, low, high) {
  if (!Number.isFinite(value)) return null;
  return `${value.toFixed(2)} (0.00 ${low} ~ 1.00 ${high})`;
}

function describeTempo(analysis) {
  if (!Number.isFinite(analysis.bpm)) return null;
  const feel = analysis.bpm < 80 ? '느림' : analysis.bpm > 130 ? '빠름' : '보통';
  return `${feel} (약 ${Math.round(analysis.bpm)} BPM)`;
}

function promptAnalysis(analysis) {
  if (!analysis) return null;
  return {
    description: analysis.description || '',
    mood: analysis.mood || [],
    instruments: analysis.instruments || [],
    vocal: analysis.vocal || [],
    structure: analysis.structure || [],
    tempo: describeTempo(analysis),
    // Valence는 어두움·밝음, Arousal은 차분함·격렬함이다.
    brightness: describeScale(analysis.valence, '어두움', '밝음'),
    energy: describeScale(analysis.arousal, '차분함', '격렬함'),
  };
}

function resolveCafePrompt(cafePrompt) {
  return compact(cafePrompt, DEFAULT_CAFE_PROMPT);
}

function buildMusicFilterMessages({ cafePrompt, track, analysis = null }) {
  const storePrompt = resolveCafePrompt(cafePrompt);

  return [
    { role: 'system', content: renderPrompt('music-filter.system.njk') },
    { role: 'user', content: renderPrompt('music-filter.user.njk', {
      cafe_policy: storePrompt,
      platform: compact(track.platform, 'unknown'),
      title: compact(track.title, 'unknown'),
      channel_title: compact(track.channelTitle, 'unknown'),
      duration: compact(track.duration, 'unknown'),
      analysis: promptAnalysis(analysis),
    }) },
  ];
}

module.exports = { buildMusicFilterMessages, resolveCafePrompt, promptAnalysis };
