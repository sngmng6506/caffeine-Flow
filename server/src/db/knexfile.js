require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const connectionString = (process.env.DATABASE_URL || '').trim();

// DATABASE_SSL 모드 (명시 설정이 항상 우선):
//   'no-verify' — TLS 암호화하되 인증서 미검증. Railway/Supabase 프록시가
//                 self-signed 체인을 쓰는 환경 호환용. MITM에는 취약.
//   'verify'    — 인증서 검증까지 수행. CA가 신뢰 체인에 있는 환경에서 권장.
//   'disable'   — TLS 없음. 사설망 직결일 때만.
//
// 미설정 시 호스트로 자동 결정: Railway 내부망(*.railway.internal)·localhost는
// SSL 미지원이라 disable, 그 외 원격(Supabase, Railway 공개 프록시)은 no-verify.
// 이 자동 감지 덕에 Railway 내부 Postgres로 옮길 때 env 변경 없이 동작한다.
function sslConfig() {
  const rawMode = process.env.DATABASE_SSL;
  const mode = (rawMode || '').trim();

  if (mode === 'disable') return false;
  if (mode === 'verify')  return { rejectUnauthorized: true };
  if (mode === 'no-verify') return { rejectUnauthorized: false };

  // 이하 미설정(자동) — 테스트 Postgres(GitHub Actions·로컬)는 SSL 미지원
  if (process.env.NODE_ENV === 'test') return false;
  if (/\.railway\.internal|@localhost|@127\.0\.0\.1|\/localhost|\/127\.0\.0\.1/.test(connectionString)) return false;
  return { rejectUnauthorized: false };
}

/** @type {import('knex').Knex.Config} */
module.exports = {
  client: 'pg',
  connection: {
    connectionString,
    ssl: sslConfig(),
  },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  pool: { min: 2, max: 10 },
};
