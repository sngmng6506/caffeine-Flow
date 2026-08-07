import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/ai-guardrails-docs.test.mjs',
      'tests/api-docs.test.mjs',
      'tests/kst.test.mjs',
      'tests/limits.test.mjs',
      'tests/music-filter.test.mjs',
      'tests/platforms.test.mjs',
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
