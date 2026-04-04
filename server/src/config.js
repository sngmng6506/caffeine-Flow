require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

module.exports = {
  PORT:            process.env.PORT || 3001,
  DATABASE_URL:    process.env.DATABASE_URL || '',
  JWT_SECRET:      process.env.JWT_SECRET || 'change-me-in-production',
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || '',
};
