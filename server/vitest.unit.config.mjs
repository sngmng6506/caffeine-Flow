import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/unit-setup.mjs'],
    include: [
      'tests/ai-guardrails-docs.test.mjs',
      'tests/api-docs.test.mjs',
      'tests/electron-navigation-policy.test.mjs',
      'tests/kst.test.mjs',
      'tests/limits.test.mjs',
      'tests/music-filter.test.mjs',
      'tests/owner-session.test.mjs',
      'tests/pagination.test.mjs',
      'tests/platforms.test.mjs',
      'tests/public-response.test.mjs',
      'tests/security-headers.test.mjs',
      'tests/time-policy.test.mjs',
      'tests/transition.test.mjs',
      'tests/validate.test.mjs',
    ],
    pool: 'forks',
    singleFork: true,
    fileParallelism: false,
  },
});
