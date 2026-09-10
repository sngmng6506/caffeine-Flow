const { buildMusicFilterMessages, resolveCafePrompt } = require('./prompt.builder');
const { callMusicFilterLlm } = require('./llm.client');
const { normalizeLlmDecision, rejectionFromError } = require('./decision.policy');
const { FILTER_ACTION, FILTER_STATUS } = require('../../constants/music-filter-status');
const { logError, CAUSE } = require('../../observability');
const { findForTrack } = require('./track-analysis');

// 음향 분석은 판단을 돕는 재료이지 판단의 전제가 아니다. 조회가 느리거나 실패해도
// 필터를 멈추지 않고 제목·아티스트만으로 판단한다. 여기서 던지면 fail-closed 정책상
// 곡이 거절되므로, 분석 조회 실패가 손님의 신청을 막는 일이 생긴다.
async function lookupAnalysis(track, context) {
  // 메시지 구성 자체가 실패할 입력이다. 조회를 시도하면 TypeError가 아래 catch에
  // 걸려 실제로는 일어나지 않은 조회 실패가 오류 채널에 남는다.
  if (!track?.platform) return null;
  try {
    return await findForTrack(track.platform, track.videoId || track.trackKey);
  } catch (error) {
    logError({ code: 'AUDIO_ANALYSIS_LOOKUP_FAILED', cause: CAUSE.PLATFORM,
      cafe: context.cafe || null, route: context.route || null, error });
    return null;
  }
}

// context는 알림에 카페 범위를 넣기 위한 것이다. 필터 실험실처럼 카페가 없는
// 호출도 있으므로 선택값으로 둔다.
async function evaluateTrack({ cafePrompt, track, model: modelOverride, context = {} }) {
  try {
    const analysis = await lookupAnalysis(track, context);
    const messages = buildMusicFilterMessages({ cafePrompt, track, analysis });
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
