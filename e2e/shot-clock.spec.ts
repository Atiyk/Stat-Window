import { expect, test, type Page } from '@playwright/test';
import { DAY1, lowBracket } from './helpers';

// Date.now must advance with the timers. setFixedTime freezes Date.now and would
// incorrectly make a real wall-clock countdown appear stuck at 24 seconds.
async function openTimed(page: Page) {
  await page.clock.install({ time: DAY1 });
  await page.goto('/');
  const skip = page.getByRole('button', { name: 'Skip tutorial and start' });
  if (await skip.isVisible()) await skip.click();
  else await page.getByRole('button', { name: "Start today's five" }).click();
  await expect(page.locator('.question')).toBeVisible();
}

test('the clock starts on appearance without a bracket touch', async ({ page }) => {
  await openTimed(page);
  await expect(page.locator('.shot-clock')).toContainText('24s');
  await page.clock.fastForward('00:06');
  const left = Number((await page.locator('.shot-clock').textContent())?.match(/(\d+)s/)?.[1]);
  expect(left).toBeGreaterThanOrEqual(17);
  expect(left).toBeLessThanOrEqual(19);
});

test('shot clock expiry is a zero-point turnover, not a normal miss or a second try', async ({ page }) => {
  await openTimed(page);
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.clock.fastForward('00:25');
  await page.clock.runFor(2500);
  await expect(page.locator('.outcome-word')).toContainText('Shot clock violation.');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') || '{}'));
  expect(saved.runs['2026-11-15'].results[0]).toMatchObject({ points: 0, timedOut: true, elapsedMs: 24000 });
  await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
});

test('refresh does not buy another 24 seconds', async ({ page }) => {
  await openTimed(page);
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.clock.fastForward('00:09');
  const firstTimestamp = await page.evaluate(() => sessionStorage.getItem('stat-window:shot:v1:nba-gsw-2016-wins'));
  expect(firstTimestamp).not.toBeNull();
  await page.reload();
  await expect.poll(async () => Number((await page.locator('.shot-clock').textContent())?.match(/(\d+)s/)?.[1])).toBeLessThanOrEqual(16);
  const left = Number((await page.locator('.shot-clock').textContent())?.match(/(\d+)s/)?.[1]);
  expect(left).toBeGreaterThanOrEqual(13);
  expect(left).toBeLessThanOrEqual(16);
  await page.clock.fastForward('00:17');
  await page.clock.runFor(2500);
  await expect(page.locator('.outcome-word')).toContainText('Shot clock violation.');
});

test('a late lock cannot score after the deadline, even before the next timer tick', async ({ page }) => {
  await openTimed(page);
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  const now = DAY1.getTime();
  await page.clock.setSystemTime(new Date(now + 24_500));
  const lock = page.getByRole('button', { name: 'Lock the window' });
  // The background tick may win the race to expire; either path must produce a timeout.
  if (await lock.isVisible()) await lock.click({ timeout: 500 }).catch(() => undefined);
  await page.clock.runFor(2500);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') || '{}'));
  expect(saved.runs['2026-11-15'].results[0]).toMatchObject({ points: 0, timedOut: true });
});


test('a completed question clears its shot deadline, so fresh challenges can replay it', async ({ page }) => {
  await openTimed(page);
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Lock the window' }).click();
  const key = 'stat-window:shot:v1:nba-gsw-2016-wins';
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?day=2026-11-15&vs=200');
  const skip = page.getByRole('button', { name: 'Skip tutorial and start' });
  if (await skip.isVisible()) await skip.click();
  else await page.getByRole('button', { name: "Start today's five" }).click();
  await expect(page.locator('.challenge-note')).toContainText('200');
  await expect(page.locator('.shot-clock')).toContainText('24s');
});

test('interactive tutorial is not scored and requires an explicit start', async ({ page }) => {
  await page.clock.install({ time: DAY1 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Catch the number.' })).toBeVisible();
  await expect(page.locator('.question')).toHaveCount(0);
  await page.getByRole('slider', { name: 'Practice low end' }).fill('40');
  await page.getByRole('button', { name: 'Reveal practice answer' }).click();
  await expect(page.getByRole('status')).toContainText('42');
  await page.getByRole('button', { name: "Start today's five" }).click();
  await expect(page.locator('.question')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') || '{}'));
  expect(saved.settings.introSeen).toBe(true);
});
test('refreshing untouched Q1 preserves the running deadline', async ({ page }) => {
  await openTimed(page);
  await page.clock.fastForward('00:09');
  await page.reload();
  await expect(page.locator('.question')).toBeVisible();
  await expect.poll(async () => Number((await page.locator('.shot-clock').textContent())?.match(/(\d+)s/)?.[1])).toBeLessThanOrEqual(16);
});
test('Q2 countdown begins on Next without touching the window', async ({ page }) => {
  await openTimed(page);
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.clock.fastForward('00:25');
  await page.clock.runFor(2500);
  await expect(page.locator('.outcome-word')).toContainText('Shot clock violation.');
});
