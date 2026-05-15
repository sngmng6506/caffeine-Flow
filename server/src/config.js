require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const env = (key, fallback = '') => (process.env[key] || fallback).trim();

// 필수 시크릿: 누락 시 무음으로 약한 기본값을 쓰는 대신 시작 시점에 명확히 실패시킴
const JWT_SECRET   = env('JWT_SECRET');
const DATABASE_URL = env('DATABASE_URL');

if (!JWT_SECRET || JWT_SECRET === 'change-me-in-production') {
  throw new Error('JWT_SECRET 환경변수가 설정되지 않았거나 기본값입니다. 32바이트 이상 랜덤 시크릿을 설정하세요. 생성: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
}

module.exports = {
  PORT:                env('PORT', '3001'),
  DATABASE_URL,
  JWT_SECRET,
  YOUTUBE_API_KEY:     env('YOUTUBE_API_KEY'),
  GOOGLE_CLIENT_ID:    env('GOOGLE_CLIENT_ID'),
  NAVER_CLIENT_ID:     env('NAVER_CLIENT_ID'),
  NAVER_CLIENT_SECRET: env('NAVER_CLIENT_SECRET'),
  APP_URL:             env('APP_URL',    'http://localhost:5174'),
  SERVER_URL:          env('SERVER_URL', 'http://localhost:3000'),
};
