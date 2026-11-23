import { defineConfig, devices } from '@playwright/test';

// ANALYTICS_E2E=1 runs against a separate build with VITE_ANALYTICS=vercel (see e2e/analytics.spec.ts).
// SURVIVAL_E2E=1 runs against two flagged builds: VITE_SURVIVAL=preview on 4175 and
// VITE_SURVIVAL=on with the CTA experiment (analytics on, Vercel stubbed by the test) on 4176 (see e2e/survival.spec.ts).
const ANALYTICS = !!process.env.ANALYTICS_E2E;
const SURVIVAL = !!process.env.SURVIVAL_E2E;
// Explicit isolated QA of dormant global leaderboard; never the V3 release build.
const LEADERBOARD = !!process.env.LEADERBOARD_E2E;
const PORT = ANALYTICS ? 4174 : SURVIVAL ? 4175 : LEADERBOARD ? 4177 : 4173;
const BUILD = ANALYTICS
  ? `VITE_ANALYTICS=vercel npx vite build --outDir dist-analytics && npx vite preview --outDir dist-analytics --port ${PORT} --strictPort`
  : SURVIVAL
    ? `VITE_SURVIVAL=preview npx vite build --outDir dist-survival && npx vite preview --outDir dist-survival --port ${PORT} --strictPort`
    : LEADERBOARD
      ? `npx vite build --mode leaderboard-scaffold-qa --outDir dist-leaderboard-test && npx vite preview --outDir dist-leaderboard-test --port ${PORT} --strictPort`
      : `npm run build && npx vite preview --port ${PORT} --strictPort`;
const SURVIVAL_ON = 'VITE_SURVIVAL=on VITE_SURVIVAL_CTA_TEST=1 VITE_ANALYTICS=vercel npx vite build --outDir dist-survival-on && npx vite preview --outDir dist-survival-on --port 4176 --strictPort';

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
    // Safari coverage (iOS WebKit). isMobile is true, so every desktop-only skip (`isMobile`) skips here too.
    // Left out: the CDP touch test (CDP is Chromium-only; the Chromium mobile project covers touch), and the
    // analytics, Survival and design-study specs, which run once on the Chromium projects by design.
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13'] },
      testIgnore: ['**/analytics.spec.ts', '**/survival.spec.ts', '**/study.spec.ts'],
      grepInvert: /touch: dragging a bracket moves it and never scrolls the page/,
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : [
        { command: BUILD, port: PORT, reuseExistingServer: !process.env.CI, timeout: 120_000 },
        ...(SURVIVAL ? [{ command: SURVIVAL_ON, port: 4176, reuseExistingServer: !process.env.CI, timeout: 120_000 }] : []),
      ],
});
