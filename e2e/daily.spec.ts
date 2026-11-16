import { expect, test } from '@playwright/test';
import { collectErrors, DAY1, DAY2, highBracket, lockAndSettle, lowBracket, next, openAt, typeWindow } from './helpers';

// Day 1 answers (content/days/2026-11-15.json): 73, 23, 92, 138, 2632
const DAY1_PLAN = [
  { lo: 72, hi: 73, expectHit: true, points: 100 }, // one step wide: max score
  { lo: 1, hi: 40, expectHit: true, points: 0 }, // 39 of 40 steps: a hit worth round(100*(1/39)^2) = 0
  { lo: 95, hi: 110, expectHit: false, points: 0 }, // miss by 3
  { lo: 130, hi: 150, expectHit: true, points: 80 }, // 20 of 180 steps: round(100*(160/179)^2) = 80
  { lo: 2600, hi: 2700, expectHit: true, points: 94 }, // 10 of 300 steps: round(100*(290/299)^2) = 94
];

test('a full daily run scores every round, saves, and shares without spoilers', async ({ page, context, browserName }) => {
  const errors = collectErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await openAt(page, DAY1);
  await expect(page.locator('.day-label')).toHaveText('No. 1');

  const points: number[] = [];
  for (const [i, round] of DAY1_PLAN.entries()) {
    await expect(page.locator('.round-meta')).toContainText(`Round ${i + 1} of 5`);
    await typeWindow(page, round.lo, round.hi);
    await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', String(round.lo));
    await expect(highBracket(page)).toHaveAttribute('aria-valuenow', String(round.hi));
    await lockAndSettle(page);
    if (round.expectHit) {
      await expect(page.locator('.outcome-hit')).toBeVisible();
      await expect(page.locator('.outcome-points')).toHaveText(`+${round.points}`);
    } else {
      await expect(page.locator('.outcome-miss')).toContainText('Missed by 3 goals');
    }
    points.push(round.points);
    await expect(page.locator('.story-source a')).toHaveAttribute('href', /^https:\/\//);
    await next(page);
  }

  await expect(page.locator('.results-title')).toBeVisible();
  expect(points.reduce((a, b) => a + b, 0)).toBe(274);
  await expect(page.locator('.results-score')).toHaveText('274');
  // Today's 274 lands in the 200–299 band of the player's own distribution.
  const todayBand = page.locator('.dist-row[data-today]');
  await expect(todayBand.locator('.dist-label')).toHaveText('200–299');
  await expect(todayBand.locator('.dist-count')).toContainText('1');
  await expect(page.locator('.recap-row')).toHaveCount(5);

  if (browserName === 'chromium' && test.info().project.name === 'desktop') {
    await page.getByRole('button', { name: 'Share result' }).click();
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    expect(shared).toBe(`Stat Window No. 1  274/500\n🟩🟧⬛🟩🟩\n${new URL(page.url()).origin}`);
    // Spoiler-free: no answer appears in the share text.
    for (const answer of ['73', '23', '92', '138', '2632', '2,632']) expect(shared.split('\n')[1]).not.toContain(answer);
  }

  // Returning later the same day opens straight to the results.
  await page.reload();
  await expect(page.locator('.results-score')).toHaveText('274');
  await expect(page.locator('.stats')).toContainText('Played1');
  expect(errors).toEqual([]);
});

test('refreshing mid-reveal keeps the locked window and shows its result', async ({ page }) => {
  await openAt(page, DAY1);
  await typeWindow(page, 60, 70); // misses 73
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await page.waitForTimeout(150);
  await page.reload();
  await expect(page.locator('.outcome-miss')).toBeVisible();
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '60');
  await next(page);
  await expect(page.locator('.round-meta')).toContainText('Round 2 of 5');
  await page.reload();
  await expect(page.locator('.round-meta')).toContainText('Round 2 of 5');
  await expect(page.locator('.ledger-cell').first()).toHaveAttribute('data-status', 'miss');
});

test('everyone gets the slate for the UTC date, and a new one at UTC midnight', async ({ page }) => {
  await openAt(page, new Date('2026-11-15T23:59:00Z'));
  await expect(page.locator('.question')).toContainText('Golden State Warriors');
  await openAt(page, new Date('2026-11-16T00:00:30Z'));
  await expect(page.locator('.day-label')).toHaveText('No. 2');
  await expect(page.locator('.question')).toContainText('Barry Bonds');
});

test('a tab left open across midnight moves to the new puzzle', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-15T23:59:30Z') });
  await page.goto('/');
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await page.clock.fastForward('01:00');
  await expect(page.locator('.day-label')).toHaveText('No. 2');
});

test('practice on an earlier day does not touch the daily record', async ({ page }) => {
  await openAt(page, DAY2);
  for (let i = 0; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.stats')).toContainText('Played1');
  await page.getByRole('button', { name: 'Nov 15' }).click();
  await expect(page.locator('.round-meta')).toContainText('Practice');
  for (let i = 0; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-head')).toContainText('not counted');
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(page.locator('.stats')).toContainText('Played1');
});

test('the game still works when storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  const errors = (await import('./helpers')).collectErrors(page);
  await openAt(page, DAY1);
  await expect(page.locator('.storage-note')).toBeVisible();
  await lockAndSettle(page);
  await next(page);
  await expect(page.locator('.round-meta')).toContainText('Round 2 of 5');
  expect(errors).toEqual([]);
});

test('corrupted save data is set aside instead of crashing', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('stat-window:v1', '{"version":1,"runs":{"2026-11-15":{"results":"nope"}}}'));
  await openAt(page, DAY1);
  await expect(page.locator('.round-meta')).toContainText('Round 1 of 5');
});
