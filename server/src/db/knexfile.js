require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

// DATABASE_SSL 모드:
//   'no-verify' (기본) — TLS 암호화하되 인증서 미검증. Railway/Supabase 프록시가
//                        self-signed 체인을 쓰는 환경 호환용. MITM에는 취약.
//   'verify'           — 인증서 검증까지 수행. CA가 신뢰 체인에 있는 환경에서 권장.
//   'disable'          — TLS 없음. Railway internal 네트워크(*.railway.internal)처럼
//                        사설망 직결일 때만.
function sslConfig() {
  const rawMode = process.env.DATABASE_SSL;
  const mode = (rawMode || 'no-verify').trim();

  // GitHub Actions와 로컬 테스트의 Postgres 서비스는 SSL을 지원하지 않는다.
  // 운영에서는 DATABASE_SSL 기본값(no-verify)을 유지하되, 테스트 환경에서는
  // 명시적으로 DATABASE_SSL을 준 경우가 아니면 SSL을 끈다.
  if (process.env.NODE_ENV === 'test' && !rawMode) return false;

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