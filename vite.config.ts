import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 개발용 도구(시나리오 패널)는 dev 서버 또는 VITE_ENABLE_DEV_TOOLS=true 일 때만 번들에 포함된다.
// 기본 `npm run build`(운영 빌드)에는 포함되지 않는다. `npm run build:demo`는 데모용으로 포함한다.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
