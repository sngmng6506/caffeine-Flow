const axios = require('axios');
const {
  APP_URL,
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL,
  OPENROUTER_APP_NAME,
  MUSIC_FILTER_MODEL,
  MUSIC_FILTER_TIMEOUT_MS,
} = require('../../config');

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    decision: {
      type: 'string',
      enum: ['accept', 'reject'],
      description: '신청곡을 수락할지 거절할지에 대한 최종 판단',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: '판단 신뢰도. 0에서 1 사이 숫자',
    },
    reason: {
      type: 'string',
      description: '사장님에게 보여줄 한국어 판단 사유 한 문장',
    },
  },
  required: ['decision', 'confidence', 'reason'],
  additionalProperties: false,
};

function withCode(error, code) {
  error.code = error.code || code;
  return error;
}

function parseContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw withCode(new Error('LLM 응답 content 누락'), 'LLM_EMPTY_RESPONSE');
  try {
    return typeof content === 'string' ? JSON.parse(content) : content;
  } catch (error) {
    throw withCode(error, 'LLM_JSON_PARSE_ERROR');
  }
}

async function callMusicFilterLlm(messages) {
  if (!OPENROUTER_API_KEY) {
    throw withCode(new Error('OPENROUTER_API_KEY 누락'), 'LLM_API_KEY_MISSING');
  }

  try {
    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        model: MUSIC_FILTER_MODEL,
        messages,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'music_filter_decision',
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
        provider: {
          require_parameters: true,
        },
      },
      {
        timeout: MUSIC_FILTER_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': APP_URL,
          'X-OpenRouter-Title': OPENROUTER_APP_NAME,
        },
      }
    );

    return {
      result: parseContent(response.data),
      model: response.data?.model || MUSIC_FILTER_MODEL,
    };
  } catch (error) {
    if (error.code === 'ECONNABORTED') throw withCode(new Error('LLM API timeout'), 'LLM_TIMEOUT');
    if (error.response?.status) {
      throw withCode(
        new Error(`OpenRouter API HTTP ${error.response.status}`),
        `LLM_HTTP_${error.response.status}`
      );
    }
    if (error.code?.startsWith?.('LLM_')) throw error;
    throw withCode(error, 'LLM_REQUEST_FAILED');
  }
}

module.exports = { callMusicFilterLlm };
