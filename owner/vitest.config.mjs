import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 사장님 화면 테스트. 순수 로직은 지금처럼 .mjs 헬퍼로 빼서 server 테스트에서
// 돌리고, 여기서는 그 헬퍼들을 엮는 React 훅의 배선을 검증한다.
// 재생 리더 판정과 자동수락처럼 "어느 자리에서 호출하는가"가 곧 계약인 부분은
// 순수 함수 테스트로는 잡히지 않는다.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
});
