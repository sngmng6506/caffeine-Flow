require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const env = (key, fallback = '') => (process.env[key] || fallback).trim();

module.exports = {
  PORT:                env('PORT', '3001'),
  DATABASE_URL:        env('DATABASE_URL'),
  JWT_SECRET:          env('JWT_SECRET', 'change-me-in-production'),
  YOUTUBE_API_KEY:     env('YOUTUBE_API_KEY'),
  GOOGLE_CLIENT_ID:    env('GOOGLE_CLIENT_ID'),
  NAVER_CLIENT_ID:     env('NAVER_CLIENT_ID'),
  NAVER_CLIENT_SECRET: env('NAVER_CLIENT_SECRET'),
  APP_URL:             env('APP_URL',    'http://localhost:5174'),
  SERVER_URL:          env('SERVER_URL', 'http://localhost:3000'),
};
