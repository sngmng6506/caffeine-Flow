require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

// DATABASE_SSL 모드:
//   'no-verify' (기본) — TLS 암호화하되 인증서 미검증. Railway/Supabase 프록시가
//                        self-signed 체인을 쓰는 환경 호환용. MITM에는 취약.
//   'verify'           — 인증서 검증까지 수행. CA가 신뢰 체인에 있는 환경에서 권장.
//   'disable'          — TLS 없음. Railway internal 네트워크(*.railway.internal)처럼
//                        사설망 직결일 때만.
function sslConfig() {
  const mode = (process.env.DATABASE_SSL || 'no-verify').trim();
  if (mode === 'disable') return false;
  if (mode === 'verify')  return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

/** @type {import('knex').Knex.Config} */
module.exports = {
  client: 'pg',
  connection: {
    connectionString: (process.env.DATABASE_URL || '').trim(),
    ssl: sslConfig(),
  },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  pool: { min: 2, max: 10 },
};
