import { expect, test } from '@playwright/test';
import { addDays, puzzleStartUtcMs } from '../src/engine/daily';
import { LAUNCH_DAY } from '../src/engine/launch-config';
import { lockAndSettle, next, startDailyIfNeeded } from './helpers';

test('a beta game in progress at midnight can finish and checks the launch schedule before opening the new day', async ({ page }) => {
  test.skip(LAUNCH_DAY === null, 'requires a committed season');
  const launch = LAUNCH_DAY!;
  const previous = addDays(launch, -1);
  const midnight = puzzleStartUtcMs(launch);
  let manifestRequests = 0;
  await page.route('**/api/scores**', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 409, json: { status: 'consent-required' } })
    : route.fulfill({ status: 503, json: { status: 'disabled' } }));
  await page.route('**/launch.json', route => {
    manifestRequests++;
    // A different schedule forces a reload. The test server serves the same bundle again.
    return route.fulfill({ json: { launchDay: addDays(launch, 1) } });
  });
  await page.clock.setFixedTime(new Date(midnight - 5_000));
  await page.goto('/');
  await startDailyIfNeeded(page);
  await lockAndSettle(page);
  await next(page);

  await page.clock.setFixedTime(new Date(midnight));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  for (let round = 1; round < 5; round++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-score')).toBeVisible();
  await expect(page.getByRole('group', { name: 'See how this score compares?' })).toBeVisible();
  expect(manifestRequests).toBe(0);
  await page.evaluate(() => { document.documentElement.dataset.testRollover = 'old-document'; });

  await page.getByRole('button', { name: 'Play today’s puzzle' }).click();
  await expect.poll(() => manifestRequests, { timeout: 3_000 }).toBe(1);
  await expect(page.locator('html')).not.toHaveAttribute('data-test-rollover', 'old-document');
  await expect(page.getByRole('button', { name: 'Play Game 1' })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') ?? '{}'));
  expect(saved.runs[previous].results).toHaveLength(5);
});
