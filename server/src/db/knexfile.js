require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const connectionString = (process.env.DATABASE_URL || '').trim();

// SSL 결정:
// - Railway 내부망(.railway.internal)·localhost 는 SSL 미사용 → 강제하면 핸드셰이크 실패.
// - 그 외(Supabase, Railway 공개 프록시 등 원격)는 SSL 사용.
// - DB_SSL 환경변수로 강제 오버라이드: 'false' → 끔, 'true' → 켬.
// Supabase(db.*.supabase.co)는 원격이라 기존과 동일하게 ssl 유지(하위호환).
function resolveSsl(connStr) {
  const override = (process.env.DB_SSL || '').trim().toLowerCase();
  if (override === 'false') return false;
  if (override === 'true') return { rejectUnauthorized: false };
  if (/\.railway\.internal|@localhost|@127\.0\.0\.1|\/localhost|\/127\.0\.0\.1/.test(connStr)) return false;
  return { rejectUnauthorized: false };
}

/** @type {import('knex').Knex.Config} */
module.exports = {
  client: 'pg',
  connection: {
    connectionString,
    ssl: resolveSsl(connectionString),
  },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  pool: { min: 2, max: 10 },
};
