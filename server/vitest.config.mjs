import { defineConfig } from 'vitest/config';

// 통합 테스트 여러 파일이 같은 Postgres에 각자 migrate.latest()를 호출한다.
// vitest 기본 병렬 실행에서는 두 파일이 동시에 knex_migrations 테이블을
// 만들려다 충돌한다(pg_type_typname_nsp_index duplicate key). 스위트가
// 작아 병렬 이득이 미미하므로 단일 fork로 순차 실행해 DB 상태 공유
// 문제를 원천 차단한다.
export default defineConfig({
  test: {
    // 마이그레이션은 globalSetup에서 1회만 적용 — 개별 테스트가 각자
    // migrate.latest()를 부르면 병렬 실행 시 knex_migrations 생성이
    // 충돌한다(CI pg_type duplicate key). globalSetup은 워커와 무관하게
    // 한 번만 돌아 경쟁이 원천적으로 없다.
    globalSetup: './tests/global-setup.mjs',
    // 여러 DB 테스트가 같은 Postgres를 공유하므로 순차 실행으로 데이터
    // 간섭도 방지한다(이중 안전장치).
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
  },
});
