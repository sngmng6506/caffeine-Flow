// React 화면과 Electron 메인 프로세스를 한 명령으로 검사한다.
// 포맷 규칙은 두지 않고 실제 버그 가능성이 있는 규칙만 사용한다.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const unusedVariables = ['error', {
  args: 'after-used',
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrors: 'none',
}];

const bugRules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': unusedVariables,
  'no-empty': ['error', { allowEmptyCatch: true }],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-async-promise-executor': 'error',
};

export default [
  { ignores: ['node_modules/**', 'dist/**', 'release/**'] },

  {
    files: ['src/**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...bugRules,
      'react-hooks/rules-of-hooks': 'error',
      // 기존 효과의 의도를 먼저 검토할 수 있도록 도입 단계에서는 경고로 둔다.
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    files: ['electron/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: bugRules,
  },

  {
    // preload는 CommonJS로 실행되지만 외부 페이지의 DOM에도 접근한다.
    files: ['electron/**/*preload.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: bugRules,
  },

  {
    files: ['*.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: bugRules,
  },
];
