const VALID_DECISIONS = ['accept', 'reject'];

function normalizeConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function normalizeLlmDecision(result) {
  if (!result || !VALID_DECISIONS.includes(result.decision)) {
    const err = new Error('LLM 필터 응답 decision 파싱 실패');
    err.code = 'LLM_INVALID_DECISION';
    throw err;
  }

  const accepted = result.decision === 'accept';
  return {
    action: accepted ? 'accept' : 'reject',
    filterStatus: accepted ? 'accepted' : 'rejected',
    reason: String(result.reason || (accepted ? '매장 분위기와 충돌하지 않는 것으로 판단되었습니다.' : '매장 분위기와 맞지 않는 것으로 판단되었습니다.')).slice(0, 1000),
    confidence: normalizeConfidence(result.confidence),
    errorCode: null,
  };
}

function rejectionFromError(err) {
  const code = err?.code || 'LLM_FILTER_ERROR';
  return {
    action: 'reject',
    filterStatus: 'error_rejected',
    reason: 'AI 음악 필터가 신청곡을 판단하지 못해 안전을 위해 자동 거절했습니다.',
    confidence: null,
    errorCode: String(code).slice(0, 80),
  };
}

module.exports = { normalizeLlmDecision, rejectionFromError };
