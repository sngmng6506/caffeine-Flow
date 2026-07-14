import { fileURLToPath } from 'node:url';

// 마이그레이션을 전체 테스트 실행 전 딱 한 번만 적용한다.
// 개별 테스트 파일이 각자 migrate.latest()를 호출하면, 병렬 실행 시
// 여러 파일이 동시에 knex_migrations 테이블을 만들려다 충돌한다
// (CI에서 pg_type_typname_nsp_index duplicate key). globalSetup은
// 워커 프로세스와 무관하게 1회만 실행되므로 경쟁 자체가 없다.
export async function setup() {
  process.env.NODE_ENV = 'test';
  const knex = (await import('../src/db/knex.js')).default;
  const migrationsDir = fileURLToPath(new URL('../src/db/migrations/', import.meta.url));
  await knex.migrate.latest({ directory: migrationsDir });
  await knex.destroy();
}
