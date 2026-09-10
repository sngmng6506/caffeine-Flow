const { renderPrompt } = require('./prompt.renderer');
const { callStructuredLlm } = require('./llm.client');

const PUBLIC_GUIDE_MAX_LENGTH = 180;
const INTERNAL_LANGUAGE_PATTERN = /\bAI\b|프롬프트|심사|점수|사장님/i;

const PUBLIC_GUIDE_SCHEMA = {
  type: 'object',
  properties: {
    notice: {
      type: 'string',
      maxLength: PUBLIC_GUIDE_MAX_LENGTH,
      description: '손님에게 보여줄 친절한 한국어 신청곡 안내 1~2문장',
    },
  },
  required: ['notice'],
  additionalProperties: false,
};

function buildPublicGuideMessages(cafePrompt) {
  return [
    { role: 'system', content: renderPrompt('public-guide.system.njk', { max_length: PUBLIC_GUIDE_MAX_LENGTH }) },
    { role: 'user', content: renderPrompt('public-guide.user.njk', { cafe_policy: String(cafePrompt || '').trim() }) },
  ];
}

function normalizePublicGuide(result) {
  const notice = typeof result?.notice === 'string'
    ? result.notice.replace(/\s+/g, ' ').trim()
    : '';
  if (
    !notice
    || notice.length > PUBLIC_GUIDE_MAX_LENGTH
    || INTERNAL_LANGUAGE_PATTERN.test(notice)
  ) {
    const error = new Error('손님용 신청곡 안내 형식 오류');
    error.code = 'LLM_PUBLIC_GUIDE_INVALID';
    throw error;
  }
  return notice;
}

async function generatePublicMusicGuide({ cafePrompt }) {
  const { result, model } = await callStructuredLlm({
    messages: buildPublicGuideMessages(cafePrompt),
    toolName: 'public_music_guide',
    toolDescription: '매장 분위기 설명을 정리한 손님용 신청곡 안내',
    schema: PUBLIC_GUIDE_SCHEMA,
  });
  return { notice: normalizePublicGuide(result), model };
}

module.exports = {
  PUBLIC_GUIDE_MAX_LENGTH,
  buildPublicGuideMessages,
  normalizePublicGuide,
  generatePublicMusicGuide,
};
