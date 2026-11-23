import { expect, test, type Page } from '@playwright/test';
import { lockAndSettle, next, startDailyIfNeeded } from './helpers';

// This suite uses a separate VITE_LAUNCH_PREVIEW=1 build, never the live beta
// or a production deployment. It proves the V3 fresh-Day-1 user contract.
test.skip(!process.env.LAUNCH_E2E, 'requires the isolated launch-preview QA build');

const LAUNCH = '2027-01-10';
const before = '2027-01-09T15:00:00Z';
const first = '2027-01-10T15:00:00Z';
const second = '2027-01-11T15:00:00Z';
const preview = `launch-preview=${LAUNCH}`;

async function at(page: Page, iso: string, path: string) {
  await page.clock.setFixedTime(new Date(iso));
  await page.route('**/api/scores**', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: '{"status":"disabled"}',
  }));
  await page.goto(path);
}

async function complete(page: Page) {
  await startDailyIfNeeded(page);
  for (let i = 0; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-score')).toBeVisible();
}

test('unset launch config preserves live beta numbering and legacy challenge links', async ({ page }) => {
  await at(page, first, '/?day=2027-01-09&vs=300');
  await startDailyIfNeeded(page);
  await expect(page.locator('.challenge-note')).toContainText('300');
  await expect(page.locator('.link-note')).toHaveCount(0);
  await expect(page.locator('.day-label')).not.toHaveText('No. 1');
});

test('a configured future launch does not prematurely retire yesterday or its score link', async ({ page }) => {
  await at(page, before, `/?day=2027-01-09&vs=300&${preview}`);
  await startDailyIfNeeded(page);
  await expect(page.locator('.challenge-note')).toContainText('300');
  await expect(page.locator('.link-note')).toHaveCount(0);
});

test('new Day 1 starts at No. 1 with no beta archive, preserving old saves but resetting stats', async ({ page }) => {
  // Play the last beta day first so there is a genuine saved historical run.
  await at(page, before, `/?${preview}`);
  await complete(page);
  expect(await page.evaluate(() => Object.keys(
    JSON.parse(localStorage.getItem('stat-window:v1') ?? '{}').runs ?? {},
  ))).toContain('2027-01-09');

  // Switching to official Day 1 must not count or publicly expose beta play.
  await at(page, first, `/?${preview}`);
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await complete(page);
  await expect(page.locator('.stats dt', { hasText: 'Played' }).locator('..').locator('dd')).toHaveText('1');
  await expect(page.locator('.archive-list')).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') ?? '{}'));
  expect(Object.keys(saved.runs)).toContain('2027-01-09');
  expect(Object.keys(saved.runs)).toContain(LAUNCH);
});

test('a retired beta challenge gives an explicit notice and strips its score/time link', async ({ page }) => {
  await at(page, first, `/?day=2027-01-09&vs=300&time=1234&${preview}`);
  await expect(page.getByRole('status')).toContainText('beta puzzle was retired');
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  const params = new URLSearchParams(new URL(page.url()).search);
  expect(params.has('day')).toBe(false);
  expect(params.has('vs')).toBe(false);
  expect(params.has('time')).toBe(false);
  expect(params.get('launch-preview')).toBe(LAUNCH);
  await startDailyIfNeeded(page);
  await expect(page.locator('.question')).toBeVisible();
  await expect(page.locator('.challenge-note')).toHaveCount(0);
});

test('Day 2 archive contains only Day 1, and new-season challenge links remain playable', async ({ page }) => {
  await at(page, second, `/?${preview}`);
  await expect(page.locator('.day-label')).toHaveText('No. 2');
  await complete(page);
  const buttons = page.locator('.archive-list button');
  await expect(buttons).toHaveCount(1);
  await expect(buttons.first()).toContainText('Jan 10');

  await at(page, second, `/?day=${LAUNCH}&vs=250&${preview}`);
  await startDailyIfNeeded(page);
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await expect(page.locator('.challenge-note')).toContainText('250');
  await expect(page.locator('.link-note')).toHaveCount(0);
});
