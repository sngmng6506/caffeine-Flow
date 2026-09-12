// 브라우저에서 도는 운영자 화면(`music-labeling-lab`, `music-filter-lab`) 전용이다.
// 서버·customer·owner는 각자 폴더에 자기 설정과 lint 스크립트가 있다.
//
// 이 설정이 루트에 있는 이유는 ESLint flat config의 기준 경로가 설정 파일이 있는
// 디렉터리이기 때문이다. server/eslint.config.mjs로는 `../music-labeling-lab`에
// 닿지 않는다("outside of base path"). 그래서 두 화면만 보는 설정을 루트에 둔다.
//
// 넣은 계기: `advanceAfterReview`가 정의되지 않은 채 배포됐다. 판정 버튼을 누르면
// 서버 저장은 성공하고 곧바로 ReferenceError가 나 화면이 멈췄는데, 서버 테스트
// 215개가 전부 통과했다. 이 코드가 린트 대상이 아니었고 정적 계약 테스트는 문자열만
// 대조했기 때문이다. no-undef 하나면 잡혔다.
//
// 포맷팅 규칙은 넣지 않는다. 목적은 실행해봐야 아는 실수를 잡는 것이다.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    files: ['music-labeling-lab/**/*.js', 'music-filter-lab/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      // 두 화면 모두 모듈 번들 없이 <script src>로 그냥 읽는다.
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
        caughtErrors: 'none',
      }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
];
