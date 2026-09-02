// 스타일이 아니라 "실행해봐야 아는 실수"를 잡는 것이 목적이다.
// 포맷팅 규칙은 넣지 않는다 — 기존 코드 스타일이 이미 일관되고,
// 포맷터를 한 번 돌리면 전 파일이 diff로 뒤집혀 리뷰가 불가능해진다.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'public/**'] },

  {
    // 서버 본체 — CommonJS
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,

      // 코드를 옮기다 남은 변수·import를 잡는다. 이번 리팩터의 안전망이다.
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        // 의도적으로 버리는 구조분해(`const { x: _x, ...rest }`)를 허용한다
        varsIgnorePattern: '^_',
        caughtErrors: 'none', // catch(error) { /* 무시 */ } 패턴을 허용한다
      }],

      // require-atomic-updates는 켜지 않는다. Express 미들웨어의 표준 패턴인
      // `req.owner = await ...`을 전부 경쟁 상태로 보고해, 실제 신호보다
      // 오탐이 훨씬 많다. 켜두면 결국 disable 주석만 늘어난다.

      // == 비교는 0/''/null이 섞이는 검증 코드에서 실제 버그가 된다
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // 던지고 잊은 Promise. 이번에 unhandledRejection 핸들러를 넣은 이유와 같다
      'no-async-promise-executor': 'error',
    },
  },

  {
    // 테스트 — ESM
    files: ['tests/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', {
        args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none',
      }],
    },
  },
];
