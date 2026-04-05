require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

module.exports = {
  PORT:                process.env.PORT || 3001,
  DATABASE_URL:        process.env.DATABASE_URL || '',
  JWT_SECRET:          process.env.JWT_SECRET || 'change-me-in-production',
  YOUTUBE_API_KEY:     process.env.YOUTUBE_API_KEY || '',
  GOOGLE_CLIENT_ID:    process.env.GOOGLE_CLIENT_ID || '',
  NAVER_CLIENT_ID:     process.env.NAVER_CLIENT_ID || '',
  NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET || '',
  APP_URL:             process.env.APP_URL    || 'http://localhost:5174',
  SERVER_URL:          process.env.SERVER_URL || 'http://localhost:3000',
};
