import { defineConfig, devices } from '@playwright/test';

// ANALYTICS_E2E=1 runs against a separate build with VITE_ANALYTICS=vercel (see e2e/analytics.spec.ts).
const ANALYTICS = !!process.env.ANALYTICS_E2E;
const PORT = ANALYTICS ? 4174 : 4173;
const BUILD = ANALYTICS
  ? `VITE_ANALYTICS=vercel npx vite build --outDir dist-analytics && npx vite preview --outDir dist-analytics --port ${PORT} --strictPort`
  : `npm run build && npx vite preview --port ${PORT} --strictPort`;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: BUILD,
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
