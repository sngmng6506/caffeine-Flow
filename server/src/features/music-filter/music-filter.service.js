const { buildMusicFilterMessages, resolveCafePrompt } = require('./prompt.builder');
const { callMusicFilterLlm } = require('./llm.client');
const { normalizeLlmDecision, rejectionFromError } = require('./decision.policy');
const { FILTER_ACTION, FILTER_STATUS } = require('../../constants/music-filter-status');
const { logError, CAUSE } = require('../../observability');

// context는 알림에 카페 범위를 넣기 위한 것이다. 필터 실험실처럼 카페가 없는
// 호출도 있으므로 선택값으로 둔다.
async function evaluateTrack({ cafePrompt, track, model: modelOverride, context = {} }) {
  const messages = buildMusicFilterMessages({
    cafePrompt,
    track,
  });

  try {
    const { result, model } = await callMusicFilterLlm(messages, modelOverride);
    return { ...normalizeLlmDecision(result), model };
  } catch (error) {
    logError({
      code: error?.code || 'LLM_REQUEST_FAILED',
      cause: CAUSE.EXTERNAL,
      cafe: context.cafe || null,
      route: context.route || null,
      error,
    });
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
    context: {
      cafe: { id: cafe.id, slug: cafe.slug },
      route: 'POST /cafes/:slug/recommendations',
    },
  });
  return { ...result, promptSnapshot };
}

module.exports = {
  evaluateRecommendation,
  evaluateTrack,
};
