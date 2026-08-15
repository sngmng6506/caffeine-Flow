const { buildMusicFilterMessages, resolveCafePrompt } = require('./prompt.builder');
const { callMusicFilterLlm } = require('./llm.client');
const { normalizeLlmDecision, rejectionFromError } = require('./decision.policy');
const { FILTER_ACTION, FILTER_STATUS } = require('../../constants/music-filter-status');

async function evaluateTrack({ cafePrompt, track }) {
  const messages = buildMusicFilterMessages({
    cafePrompt,
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

  const promptSnapshot = resolveCafePrompt(cafe.music_filter_prompt);
  const result = await evaluateTrack({
    cafePrompt: promptSnapshot,
    track,
  });
  return { ...result, promptSnapshot };
}

module.exports = {
  evaluateRecommendation,
  evaluateTrack,
};
