const { buildMusicFilterMessages } = require('./prompt.builder');
const { callMusicFilterLlm } = require('./llm.client');
const { normalizeLlmDecision, rejectionFromError } = require('./decision.policy');
const { FILTER_ACTION, FILTER_STATUS } = require('../../constants/music-filter-status');

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

  const messages = buildMusicFilterMessages({
    cafePrompt: cafe.music_filter_prompt,
    strictness: cafe.music_filter_strictness || 'medium',
    track,
  });

  try {
    const { result, model } = await callMusicFilterLlm(messages);
    return { ...normalizeLlmDecision(result), model };
  } catch (err) {
    console.error('[music-filter] LLM 판단 실패:', err?.code || err?.message || err);
    return { ...rejectionFromError(err), model: null };
  }
}

module.exports = { evaluateRecommendation };
