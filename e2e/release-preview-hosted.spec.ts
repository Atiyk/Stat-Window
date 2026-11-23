import { expect, test, type Page } from '@playwright/test';
import { startDailyIfNeeded } from './helpers';

// Disposable, read-only external test. It MUST NOT be included in shipping CI.
test.skip(!process.env.LIVE_PREVIEW_E2E, 'Only the isolated external V3 QA worker runs this suite');

async function visit(page: Page, utc: string, url: string) {
  await page.clock.setFixedTime(new Date(utc));
  // Never contact a live percentile store, even for reads.
  await page.route('**/api/scores**', route => route.fulfill({
    status: 503, contentType: 'application/json', body: '{"status":"disabled"}',
  }));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

test('the deployed November 28 preview really starts as No. 1, not old beta', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await visit(page, '2026-11-28T16:00:00Z', '/?day=2026-11-27&vs=210&time=4800');
  await expect(page.locator('.link-note')).toContainText('beta puzzle was retired');
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  const u = new URL(page.url());
  for (const k of ['day', 'vs', 'time']) expect(u.searchParams.has(k)).toBe(false);
  await expect(page.locator('.challenge-note')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await startDailyIfNeeded(page);
  await expect(page.locator('.question')).toBeVisible();
  await expect(page.locator('.shot-clock')).toContainText('24s');
  await expect(page.locator('.question')).not.toContainText('How many regular-season games did the 2015');
  expect(errors).toEqual([]);
});

test('old beta links work before Eastern midnight and retire exactly on launch', async ({ page }) => {
  const link = '/?day=2026-11-27&vs=210';
  await visit(page, '2026-11-28T04:59:59Z', link);
  await startDailyIfNeeded(page);
  await expect(page.locator('.challenge-note')).toContainText('210');
  await visit(page, '2026-11-28T05:00:00Z', link);
  await expect(page.locator('.link-note')).toContainText('beta puzzle was retired');
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await expect(page.locator('.challenge-note')).toHaveCount(0);
});

test('Day 2 shows No. 2 and old beta archives are not playable', async ({ page }) => {
  await visit(page, '2026-11-29T16:00:00Z', '/');
  await expect(page.locator('.day-label')).toHaveText('No. 2');
  await expect(page.locator('.archive-list button')).toHaveCount(1);
  await expect(page.locator('.archive-list button').first()).toContainText('Nov 28');
});
