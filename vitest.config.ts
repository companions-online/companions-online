import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared/src'),
      '@client-webgl': path.resolve(__dirname, 'client-webgl/src'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'harness/test/**/*.test.ts', 'harness/eval/test/**/*.test.ts'],
    globalSetup: ['./scripts/vitest-global-setup.ts'],
  },
});
