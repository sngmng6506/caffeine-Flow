const { buildMusicFilterMessages } = require('./prompt.builder');
const { callMusicFilterLlm } = require('./llm.client');
const { normalizeLlmDecision, rejectionFromError } = require('./decision.policy');
const { FILTER_ACTION, FILTER_STATUS } = require('../../constants/music-filter-status');
const { DEFAULT_MUSIC_FILTER_STRICTNESS } = require('../../constants/music-filter-policy');

async function evaluateTrack({ cafePrompt, strictness = DEFAULT_MUSIC_FILTER_STRICTNESS, track }) {
  const messages = buildMusicFilterMessages({
    cafePrompt,
    strictness,
    track,
  });

  try {
    const { result, model } = await callMusicFilterLlm(messages);
    return { ...normalizeLlmDecision(result), model };
  } catch (error) {
    console.error('[music-filter] LLM 판단 실패:', error?.code || error?.message || error);
    return { ...rejectionFromError(error), model: null };
  }
}

async function evaluateRecommendation({ cafe, track }) {
  if (!cafe.music_filter_enabled) {
    return {
      action: FILTER_ACTION.ACCEPT,
      filterStatus: FILTER_STATUS.SKIPPED,
      reason: null,
      confidence: null,
      model: null,
      errorCode: null,
    };
  }

  return evaluateTrack({
    cafePrompt: cafe.music_filter_prompt,
    strictness: cafe.music_filter_strictness || DEFAULT_MUSIC_FILTER_STRICTNESS,
    track,
  });
}

module.exports = {
  evaluateRecommendation,
  evaluateTrack,
};
