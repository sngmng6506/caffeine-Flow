import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 손님 화면 테스트. owner와 같은 규칙을 쓴다.
// 순수 로직은 .mjs/.js 모듈로 두고 여기서 직접 검증하고, 컴포넌트는 렌더링
// 결과가 아니라 "어떤 입력에 어떤 동작을 하는가"만 본다. 화면을 볼 수 없는
// 환경이라 스타일과 레이아웃은 테스트 대상이 아니다.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
});
