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
  const message = data?.choices?.[0]?.message;
  // 구조화 출력을 tool(function) call로 강제한다. OpenAI·Anthropic 등 프로바이더
  // 무관하게 arguments(JSON 문자열)에서 판단 결과를 읽는다. 일부 프로바이더가
  // content로 반환하는 경우를 대비해 fallback도 둔다.
  const raw = message?.tool_calls?.[0]?.function?.arguments ?? message?.content;
  if (!raw) throw withCode(new Error('LLM 응답 판단 결과 누락'), 'LLM_EMPTY_RESPONSE');
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw withCode(error, 'LLM_JSON_PARSE_ERROR');
  }
}

async function callMusicFilterLlm(messages, modelOverride) {
  if (!OPENROUTER_API_KEY) {
    throw withCode(new Error('OPENROUTER_API_KEY 누락'), 'LLM_API_KEY_MISSING');
  }
  const model = modelOverride || MUSIC_FILTER_MODEL;

  try {
    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        model,
        messages,
        temperature: 0,
        // response_format(json_schema)는 OpenAI 계열만 지원해 Anthropic 등에서
        // 404가 났다. tool(function) calling은 프로바이더 공통이라 강제 호출로
        // 동일한 구조화 출력을 받는다.
        tools: [
          {
            type: 'function',
            function: {
              name: 'music_filter_decision',
              description: '신청곡을 수락 또는 거절로 판단한 결과',
              parameters: RESPONSE_SCHEMA,
            },
          },
        ],
        // 강제 호출로 항상 판단 도구를 쓰게 한다. require_parameters는 Anthropic
        // 엔드포인트를 걸러 404를 유발하므로 두지 않는다(tool_choice로 충분).
        tool_choice: {
          type: 'function',
          function: { name: 'music_filter_decision' },
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
      model: response.data?.model || model,
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
