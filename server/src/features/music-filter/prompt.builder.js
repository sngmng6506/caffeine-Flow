const { renderPrompt } = require('./prompt.renderer');

function compact(value, fallback = '') {
  return String(value || fallback).trim();
}

const DEFAULT_CAFE_PROMPT = '이 매장의 분위기를 해치지 않는 곡만 허용합니다.';

// 숫자를 그대로 주면 모델이 척도를 모른 채 해석한다. 0~1 값의 뜻을 말로 바꿔 준다.
function band(value, low, high) {
  if (!Number.isFinite(value)) return null;
  if (value < 0.35) return low;
  if (value > 0.65) return high;
  return '중간';
}

function describeTempo(analysis) {
  if (!Number.isFinite(analysis.bpm)) return null;
  const feel = analysis.bpm < 80 ? '느림' : analysis.bpm > 130 ? '빠름' : '보통';
  return `${feel} (약 ${Math.round(analysis.bpm)} BPM)`;
}

// Valence는 밝음·어두움, Arousal은 차분함·격렬함이다. 둘을 한 줄로 합쳐 읽기 쉽게 한다.
function describeEnergy(analysis) {
  const mood = band(analysis.valence, '어두움', '밝음');
  const energy = band(analysis.arousal, '차분함', '격렬함');
  return [mood, energy].filter(Boolean).join(' · ') || null;
}

function promptAnalysis(analysis) {
  if (!analysis) return null;
  return {
    description: analysis.description || '',
    mood: analysis.mood || [],
    instruments: analysis.instruments || [],
    vocal: analysis.vocal || [],
    // 점수는 넣지 않는다. 보정되지 않은 상대값이라 숫자를 보여주면 곡끼리 비교하게 된다.
    styles: (analysis.styles || []).map((v) => v.label),
    tempo: describeTempo(analysis),
    energy: describeEnergy(analysis),
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
