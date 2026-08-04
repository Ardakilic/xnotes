import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileTimeout: 600_000,
  },
});
