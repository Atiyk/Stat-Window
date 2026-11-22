import { expect, test, type Page } from '@playwright/test';
import { DAY1, lowBracket } from './helpers';

// Date.now must advance with the timers. setFixedTime freezes Date.now and would
// incorrectly make a real wall-clock countdown appear stuck at 24 seconds.
async function openTimed(page: Page) {
  await page.clock.install({ time: DAY1 });
  await page.goto('/');
  const ready = page.getByRole('button', { name: /^(Skip tutorial and start|Start today's five)$/ });
  await expect(ready).toBeVisible();
  await ready.click();
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
  await expect.poll(() => page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?day=2026-11-15&vs=200');
  const ready = page.getByRole('button', { name: /^(Skip tutorial and start|Start today's five)$/ });
  await expect(ready).toBeVisible();
  await ready.click();
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

test('reload during Q2 preserves its deadline without another ready CTA', async ({ page }) => {
  await openTimed(page);
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
  await page.getByRole('button', { name: 'Next question' }).click();
  await expect(page.locator('.question')).toBeFocused();
  await page.clock.fastForward('00:09');
  await page.reload();
  await expect(page.locator('.round-label')).toContainText('Question');
  await expect(page.getByRole('button', { name: "Start today's five" })).toHaveCount(0);
  await expect.poll(async () => Number((await page.locator('.shot-clock').textContent())?.match(/(\d+)s/)?.[1])).toBeLessThanOrEqual(16);
  await page.clock.fastForward('00:17');
  await page.clock.runFor(2500);
  await expect(page.locator('.outcome-word')).toContainText('Shot clock violation.');
});

test('restoring a resolved round does not leave an expired deadline for replay', async ({ page }) => {
  await openTimed(page);
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
  const key = 'stat-window:shot:v1:nba-gsw-2016-wins';
  await page.reload();
  await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
  expect(await page.evaluate(k => sessionStorage.getItem(k), key)).toBeNull();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?day=2026-11-15&vs=200');
  const ready = page.getByRole('button', { name: /^(Skip tutorial and start|Start today's five)$/ });
  await expect(ready).toBeVisible();
  await ready.click();
  await expect(page.locator('.shot-clock')).toContainText('24s');
});

test('returning from a hidden tab enforces wall-clock expiration', async ({ page }) => {
  await openTimed(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  await page.clock.setSystemTime(new Date(DAY1.getTime() + 25_000));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(2500);
  await expect(page.locator('.outcome-word')).toContainText('Shot clock violation.');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') || '{}'));
  expect(saved.runs['2026-11-15'].results[0]).toMatchObject({ points: 0, timedOut: true, elapsedMs: 24000 });
});

test('untouched Q1 keeps its original day and deadline after midnight reload', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-16T04:59:50Z') });
  await page.goto('/');
  const ready = page.getByRole('button', { name: /^(Skip tutorial and start|Start today's five)$/ });
  await expect(ready).toBeVisible();
  await ready.click();
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await page.clock.fastForward('00:05');
  await page.reload();
  await expect(page.locator('.question')).toBeVisible();
  await page.clock.fastForward('00:10');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await expect(page.locator('.round-label')).toContainText('Question');
  await expect.poll(async () => Number((await page.locator('.shot-clock').textContent())?.match(/(\d+)s/)?.[1])).toBeLessThanOrEqual(10);
});
