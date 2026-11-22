import { expect, test, type Page } from '@playwright/test';
import { DAY1, lowBracket } from './helpers';

// Date.now must advance with the timers. setFixedTime freezes Date.now and would
// incorrectly make a real wall-clock countdown appear stuck at 24 seconds.
async function openTimed(page: Page) {
  await page.clock.install({ time: DAY1 });
  await page.goto('/');
  await expect(page.locator('.question')).toBeVisible();
}

test('first-play guide grants reading time; numeric editor starts the 24-second shot clock', async ({ page }) => {
  await openTimed(page);
  await expect(page.locator('.shot-clock')).toContainText('24s · ready');
  await page.clock.fastForward('00:15');
  await expect(page.locator('.shot-clock')).toContainText('24s · ready');
  await page.getByRole('button', { name: /^Low end:/ }).click();
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
  await page.reload();
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
