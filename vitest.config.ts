import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'scripts/growth-report.test.mjs', 'server/**/*.test.ts'], environment: 'node' },
});
