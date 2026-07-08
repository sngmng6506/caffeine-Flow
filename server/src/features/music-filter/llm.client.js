const axios = require('axios');
const {
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
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
    return JSON.parse(content);
  } catch (err) {
    throw withCode(err, 'LLM_JSON_PARSE_ERROR');
  }
}

async function callMusicFilterLlm(messages) {
  if (!OPENAI_API_KEY) {
    throw withCode(new Error('OPENAI_API_KEY 누락'), 'LLM_API_KEY_MISSING');
  }

  try {
    const res = await axios.post(
      `${OPENAI_BASE_URL}/chat/completions`,
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
      },
      {
        timeout: MUSIC_FILTER_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      result: parseContent(res.data),
      model: res.data?.model || MUSIC_FILTER_MODEL,
    };
  } catch (err) {
    if (err.code === 'ECONNABORTED') throw withCode(err, 'LLM_TIMEOUT');
    if (err.response?.status) {
      throw withCode(new Error(`LLM API HTTP ${err.response.status}`), `LLM_HTTP_${err.response.status}`);
    }
    if (err.code?.startsWith?.('LLM_')) throw err;
    throw withCode(err, 'LLM_REQUEST_FAILED');
  }
}

module.exports = { callMusicFilterLlm };
