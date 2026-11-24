import { expect, test, type Page } from '@playwright/test';
import { DAY1, lowBracket, startDailyIfNeeded } from './helpers';

// Date.now must advance with the timers. setFixedTime freezes Date.now and would
// incorrectly make a real wall-clock countdown appear stuck at 24 seconds.
async function openTimed(page: Page) {
  await page.clock.install({ time: DAY1 });
  await page.goto('/');
  await startDailyIfNeeded(page);
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
  await expect(page.locator('.outcome-word')).toHaveText('Time’s up.');
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
  await expect(page.locator('.outcome-word')).toHaveText('Time’s up.');
});

test('a late lock cannot score after the deadline, even before the next timer tick', async ({ page }) => {
  await openTimed(page);
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  const startedAt = await page.evaluate(() => Number(sessionStorage.getItem('stat-window:shot:v1:nba-gsw-2016-wins')));
  expect(startedAt).toBeGreaterThan(0);
  await page.clock.setSystemTime(new Date(startedAt + 24_500));
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
  await startDailyIfNeeded(page);
  await expect(page.locator('.challenge-note')).toContainText('200');
  await expect(page.locator('.shot-clock')).toContainText('24s');
});

test('interactive tutorial is not scored and requires an explicit start', async ({ page }) => {
  await page.clock.install({ time: DAY1 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^How many regular-season games did the 2015/ })).toBeVisible();
  await expect(page.locator('.onboarding-play .ruler')).toBeVisible();
  await expect(page.locator('.onboarding-play .readout')).toBeVisible();
  await expect(page.locator('.round:not(.onboarding-play) .question')).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Low end of your window' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'High end of your window' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'High end of your window' })).toHaveAttribute('aria-valuemax', '82');
  await expect(page.locator('.shot-clock')).toContainText('No timer');
  // Real input interaction: tap the large number and type an exact bound.
  await page.getByRole('button', { name: /^Low end: / }).click();
  await page.getByRole('textbox', { name: /^Low end, between/ }).fill('30');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await expect(page.locator('.onboarding-play .story-answer')).toContainText('73');
  await expect(page.locator('.onboarding-play .ruler[data-state="hit"]')).toBeVisible();
  await expect(page.locator('.onboarding-play .story')).toContainText('The Warriors finished 73–9');
  // Source links were deliberately removed from the player-facing practice reveal.
  await expect(page.locator('.onboarding-play .story a')).toHaveCount(0);
  const unsaved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') || '{}'));
  expect(unsaved.runs?.['2026-11-15']?.results ?? []).toHaveLength(0);
  await page.getByRole('button', { name: "Start today's five" }).click();
  await expect(page.locator('.question')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') || '{}'));
  expect(saved.settings.introSeen).toBe(true);
});
test('first-play practice mirrors the real round on 320px mobile without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.clock.install({ time: DAY1 });
  await page.goto('/');
  await expect(page.locator('h1.onboarding-practice-title')).toBeVisible();
  await expect(page.locator('.onboarding-play .readout')).toBeVisible();
  await expect(page.locator('.onboarding-play .ruler')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip tutorial and start' })).toBeVisible();
  await expect(page.locator('.round:not(.onboarding-play) .question')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
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
  await expect(page.locator('.outcome-word')).toHaveText('Time’s up.');
});

test('opening and abandoning the tutorial does not start the clock or a scored run', async ({ page }) => {
  await page.clock.install({ time: DAY1 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^How many regular-season games did the 2015/ })).toBeVisible();
  await expect(page.locator('.round:not(.onboarding-play) .question')).toHaveCount(0);
  const before = await page.evaluate(() => ({
    deadline: sessionStorage.getItem('stat-window:shot:v1:nba-gsw-2016-wins'),
    sent: JSON.parse(localStorage.getItem('stat-window:sent') || '{}') as Record<string,string>,
  }));
  expect(before.deadline).toBeNull();
  expect(Object.keys(before.sent).some(key => key.startsWith('start:'))).toBe(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: /^How many regular-season games did the 2015/ })).toBeVisible();
  await page.getByRole('button', { name: 'Skip tutorial and start' }).click();
  await expect(page.locator('.question')).toBeVisible();
  const after = await page.evaluate(() => ({
    deadline: sessionStorage.getItem('stat-window:shot:v1:nba-gsw-2016-wins'),
    sent: JSON.parse(localStorage.getItem('stat-window:sent') || '{}') as Record<string,string>,
  }));
  expect(after.deadline).not.toBeNull();
  expect(Object.keys(after.sent).filter(key => key.startsWith('start:'))).toHaveLength(1);
});


test('first-play rehearsal allows a miss and a retry without starting any daily shot clock', async ({ page }) => {
  await page.clock.install({ time: DAY1 });
  await page.goto('/');
  await expect(page.locator('.onboarding-play')).toBeVisible();
  const clockKey = 'stat-window:shot:v1:nba-gsw-2016-wins';
  await expect(page.getByRole('button', { name: 'Pull the brackets in first' })).toBeDisabled();
  await page.getByRole('slider', { name: 'High end of your window' }).focus();
  await page.keyboard.press('Home'); // moves the high bracket near the minimum, missing 73
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await expect(page.locator('.onboarding-play .outcome-word')).toContainText('Outside.');
  await expect(page.locator('.onboarding-play .story-answer')).toContainText('73');
  expect(await page.evaluate(k => sessionStorage.getItem(k), clockKey)).toBeNull();
  await page.getByRole('button', { name: 'Try another window' }).click();
  await expect(page.locator('.onboarding-play .story-answer')).toHaveCount(0);
  await expect(page.locator('.onboarding-play .ruler')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pull the brackets in first' })).toBeDisabled();
  expect(await page.evaluate(k => sessionStorage.getItem(k), clockKey)).toBeNull();
});


test('reduced-motion first-play practice preserves focus and layout across five device widths', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: DAY1 });
  await page.goto('/');
  const headline=page.locator('h1.onboarding-practice-title');
  await expect(headline).toBeVisible();
  await expect(headline).toBeFocused();
  await expect(page.locator('.round:not(.onboarding-play) .question')).toHaveCount(0);
  await expect(page.locator('.shot-clock')).toContainText('No timer');

  for (const [width,height] of [[320,568],[375,667],[390,844],[720,450],[1440,900]] as const) {
    await page.setViewportSize({ width, height });
    await expect(headline).toBeVisible();
    await expect(page.locator('.onboarding-play .ruler')).toBeVisible();
    const actual=await page.evaluate(() => document.documentElement.scrollWidth);
    expect(actual,'onboarding overflows at '+width+'x'+height).toBeLessThanOrEqual(width+1);
  }

  // The practice uses the same keyboard-accessible lower bracket as live play.
  await page.getByRole('slider', { name: 'Low end of your window' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await expect(page.locator('.onboarding-play .story-answer')).toContainText('73');
  await expect(page.locator('.onboarding-play .story')).toBeFocused();
  const before=await page.evaluate(() => ({
    score: JSON.parse(localStorage.getItem('stat-window:v1') || '{}'),
    deadline: sessionStorage.getItem('stat-window:shot:v1:nba-gsw-2016-wins'),
  }));
  expect(before.score.runs?.['2026-11-15']?.results??[]).toHaveLength(0);
  expect(before.deadline).toBeNull();
  await page.getByRole('button', { name: "Start today's five" }).click();
  await expect(page.locator('.round:not(.onboarding-play) .question')).toBeVisible();
  await expect(page.locator('.shot-clock')).toContainText('24s');
});

test('second tab inherits the unfinished daily shot-clock deadline instead of a free 24 seconds', async ({ page, context }) => {
  await openTimed(page);
  await page.clock.fastForward('00:10');
  const snapshot = (tab: Page) => tab.evaluate(() => ({
    now: Date.now(),
    shared: localStorage.getItem('stat-window:shot:daily:v1:2026-11-15:nba-gsw-2016-wins'),
    session: sessionStorage.getItem('stat-window:shot:v1:nba-gsw-2016-wins'),
    allShared: Object.keys(localStorage).filter(k => k.startsWith('stat-window:shot:')),
  }));
  const first = await snapshot(page);
  const second = await context.newPage();
  try {
    await second.clock.install({ time: new Date(DAY1.getTime() + 10_000) });
    await second.goto('/');
    const before = await snapshot(second);
    await startDailyIfNeeded(second);
    await expect(second.locator('.question')).toBeVisible();
    const after = await snapshot(second);
    expect(first.shared).not.toBeNull();
    expect(before.shared).toBe(first.shared);
    expect(after.shared).toBe(first.shared);
    await expect.poll(async () => Number((await second.locator('.shot-clock').textContent())?.match(/(\d+)s/)?.[1])).toBeLessThanOrEqual(15);
    const remain = Number((await second.locator('.shot-clock').textContent())?.match(/(\d+)s/)?.[1]);
    expect(remain).toBeGreaterThanOrEqual(13);
    // Refresh the second tab; neither session nor shared local storage gives time back.
    await second.clock.fastForward('00:05');
    await second.reload();
    await expect.poll(async () => Number((await second.locator('.shot-clock').textContent())?.match(/(\d+)s/)?.[1])).toBeLessThanOrEqual(10);
  } finally {
    await second.close();
  }
});

test('a blocked localStorage getter does not crash the daily clock', async ({ page }) => {
  await page.clock.install({ time: DAY1 });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Storage blocked', 'SecurityError'); },
    });
  });
  await page.goto('/');
  await startDailyIfNeeded(page);
  await expect(page.locator('.question')).toBeVisible();
  await expect(page.locator('.shot-clock')).toContainText('24s');
  await page.clock.fastForward('00:25');
  await page.clock.runFor(2500);
  await expect(page.locator('.outcome-word')).toHaveText('Time’s up.');
});

test('backgrounded daily play expires by wall time without granting another attempt on return', async ({ page }) => {
  await openTimed(page);
  const original = await page.evaluate(() => sessionStorage.getItem('stat-window:shot:v1:nba-gsw-2016-wins'));
  expect(original).not.toBeNull();
  // Simulate a hidden tab while the browser throttles interval callbacks. The
  // visibility handler must check Date.now, not count ticks or user touches.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.setSystemTime(new Date(DAY1.getTime() + 25_000));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(2500);
  await expect(page.locator('.outcome-word')).toHaveText('Time’s up.');
  await expect(page.getByRole('button', { name: 'Lock the window' })).toHaveCount(0);
  const run = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') || '{}'));
  expect(run.runs['2026-11-15'].results[0]).toMatchObject({ points: 0, timedOut: true, elapsedMs: 24000 });
  expect(await page.evaluate(() => sessionStorage.getItem('stat-window:shot:v1:nba-gsw-2016-wins'))).toBeNull();
});

test('a running daily round retains its deadline across Eastern midnight', async ({ page }) => {
  const beforeMidnight = new Date('2026-11-16T04:59:50.000Z'); // 11:59:50 PM EST on Nov 15
  await page.clock.install({ time: beforeMidnight });
  await page.goto('/');
  await startDailyIfNeeded(page);
  await expect(page.locator('.question')).toBeVisible();
  const started = await page.evaluate(() => sessionStorage.getItem('stat-window:shot:v1:nba-gsw-2016-wins'));
  expect(started).not.toBeNull();
  await page.clock.fastForward('00:15');
  // Midnight is not a new 24-second allowance for an already mounted round.
  await expect.poll(async () => Number((await page.locator('.shot-clock').textContent())?.match(/(\d+)s/)?.[1])).toBeLessThanOrEqual(9);
  await page.clock.fastForward('00:10');
  await page.clock.runFor(2500);
  await expect(page.locator('.outcome-word')).toHaveText('Time’s up.');
});


test('other tabs reuse a scored first question rather than replaying it after reload', async ({ page, context }) => {
  await openTimed(page);
  const second = await context.newPage();
  try {
    await second.clock.install({ time: DAY1 });
    await second.goto('/');
    await startDailyIfNeeded(second);
    await expect(second.locator('.question')).toBeVisible();
    await page.clock.fastForward('00:10');

    await lowBracket(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Lock the window' }).click();

    // A completion in tab A is one durable Q1 result for the whole origin.
    // Tab B must hydrate that result, not restart Q1 with a new shot clock.
    await expect.poll(async () => second.evaluate(() => {
      const save = JSON.parse(localStorage.getItem('stat-window:v1') || '{}');
      return save.runs?.['2026-11-15']?.results?.length ?? 0;
    })).toBe(1);
    await second.reload();
    await expect(second.locator('.outcome-word')).toBeVisible();
    await expect(second.getByRole('button', { name: 'Lock the window' })).toHaveCount(0);
    expect(await second.evaluate(() => sessionStorage.getItem('stat-window:shot:v1:nba-gsw-2016-wins'))).toBeNull();

    const beforeNext = await second.evaluate(() => {
      const save = JSON.parse(localStorage.getItem('stat-window:v1') || '{}');
      return save.runs?.['2026-11-15']?.results ?? [];
    });
    expect(beforeNext).toHaveLength(1);
    expect(beforeNext[0].questionId).toBe('nba-gsw-2016-wins');

    await second.getByRole('button', { name: 'Next question' }).click();
    await expect(second.locator('.question')).toBeVisible();
    await expect(second.locator('.shot-clock')).toContainText('24s');
    const afterNext = await second.evaluate(() => {
      const save = JSON.parse(localStorage.getItem('stat-window:v1') || '{}');
      return save.runs?.['2026-11-15']?.results ?? [];
    });
    expect(afterNext).toHaveLength(1);
  } finally {
    await second.close();
  }
});
