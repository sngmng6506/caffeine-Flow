require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const env = (key, fallback = '') => (process.env[key] || fallback).trim();

// 필수 시크릿: 누락 시 무음으로 약한 기본값을 쓰는 대신 시작 시점에 명확히 실패시킴
const JWT_SECRET = env('JWT_SECRET');
const DATABASE_URL = env('DATABASE_URL');

if (!JWT_SECRET || JWT_SECRET === 'change-me-in-production') {
  throw new Error('JWT_SECRET 환경변수가 설정되지 않았거나 기본값입니다. 32바이트 이상 랜덤 시크릿을 설정하세요. 생성: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
}

const OPENROUTER_API_KEY = env('OPENROUTER_API_KEY');
const OPENROUTER_BASE_URL = env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1').replace(/\/$/, '');

module.exports = {
  PORT: env('PORT', '3000'),
  DATABASE_URL,
  JWT_SECRET,
  GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID'),
  NAVER_CLIENT_ID: env('NAVER_CLIENT_ID'),
  NAVER_CLIENT_SECRET: env('NAVER_CLIENT_SECRET'),
  APP_URL: env('APP_URL', 'http://localhost:5174'),
  SERVER_URL: env('SERVER_URL', 'http://localhost:3000'),

  // 운영자(플랫폼 어드민) 콘솔 비밀번호. 미설정이면 /api/v1/admin/login이
  // 항상 503을 반환해 콘솔이 비활성 상태로 남는다 — JWT_SECRET처럼 부팅을
  // 막지는 않는다. 어드민은 부가 도구라, 미설정 때문에 서비스 전체가
  // 못 뜨는 편이 더 나쁘기 때문.
  ADMIN_PASSWORD: env('ADMIN_PASSWORD'),

  // AI 음악 필터 — 실제 신청과 사장님 테스트가 동일한 OpenRouter 설정을 공유한다.
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL,
  OPENROUTER_APP_NAME: env('OPENROUTER_APP_NAME', 'Caffeine Flow'),
  // OpenRouter에서 response_format json_schema(strict) 구조화 출력을 지원하는
  // 모델이어야 한다. Anthropic 계열은 이 방식을 지원하지 않아 404(fail-closed)로
  // 이어지므로 OpenAI 계열을 사용한다.
  MUSIC_FILTER_MODEL: env('MUSIC_FILTER_MODEL', 'openai/gpt-4o'),
  MUSIC_FILTER_TIMEOUT_MS: Number(env('MUSIC_FILTER_TIMEOUT_MS', '8000')) || 8000,
};
