import { expect, test } from '@playwright/test';
import { collectErrors, DAY1, DAY2, NBA_FIRST, highBracket, lockAndSettle, lowBracket, next, openAt, typeWindow, startDailyIfNeeded } from './helpers';

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
    await expect(page.locator('.round-meta')).toContainText(`Question ${i + 1} of 5`);
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
    await page.locator('.sources summary').click();
    await expect(page.locator('.sources a').first()).toHaveAttribute('href', /^https:\/\//);
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
    await page.getByRole('button', { name: 'Challenge a friend' }).click();
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    const origin = new URL(page.url()).origin;
    expect(shared).toContain('Stat Window No. 1  274/500');
    expect(shared).toContain('Same five questions. Can you beat 274?');
    expect(shared).toContain(`${origin}/?day=2026-11-15&vs=274&time=`);
    // Spoiler-free: no answer appears in the share text.
    for (const answer of ['73', '23', '92', '138', '2632', '2,632']) {
      for (const line of shared.split('\n').slice(1, 3)) expect(line).not.toContain(answer);
    }
  }

  // Returning later the same day opens straight to the results.
  await page.reload();
  await expect(page.locator('.results-score')).toHaveText('274');
  await expect(page.locator('.stats')).toContainText('Played1');
  expect(errors).toEqual([]);
});

test('verified NBA bonus trivia appears only after a reveal and stays stable after reload', async ({ page }) => {
  await openAt(page, NBA_FIRST);
  await expect(page.locator('.story-extra')).toHaveCount(0);
  await lockAndSettle(page);
  const fact = page.locator('.story-extra-text');
  await expect(fact).toBeVisible();
  const first = await fact.textContent();
  expect(first?.length).toBeGreaterThan(20);
  await page.locator('.sources summary').click();
  await expect(page.locator('.sources').getByRole('link').nth(2)).toHaveAttribute('href', /^https:\/\/en\.wikipedia\.org\//);
  await page.reload();
  await expect(page.locator('.story-extra-text')).toHaveText(first!);
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
  await expect(page.locator('.round-meta')).toContainText('Question 2 of 5');
  await page.reload();
  await expect(page.locator('.round-meta')).toContainText('Question 2 of 5');
  await expect(page.locator('.ledger-cell').first()).toHaveAttribute('data-status', 'miss');
});

test('everyone gets the slate for the Eastern date, and a new one at midnight Eastern', async ({ page }) => {
  await openAt(page, new Date('2026-11-16T04:59:00Z'));
  await expect(page.locator('.question')).toContainText('Golden State Warriors');
  await openAt(page, new Date('2026-11-16T05:00:30Z'));
  await expect(page.locator('.day-label')).toHaveText('No. 2');
  await expect(page.locator('.question')).toContainText('Barry Bonds');
});

test('an idle tab before Start sees the next Eastern day without burning question time', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-16T04:59:50Z') });
  await page.goto('/');
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await expect(page.locator('.round:not(.onboarding-play) .question')).toHaveCount(0);
  await page.clock.fastForward('00:45');
  await expect(page.locator('.day-label')).toHaveText('No. 2');
  await expect(page.locator('.round:not(.onboarding-play) .question')).toHaveCount(0);
  await startDailyIfNeeded(page);
  await expect(page.locator('.question')).toContainText('Barry Bonds');
});

test('an adjusted but not locked first window survives Eastern midnight', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-16T04:59:50Z') });
  await page.goto('/');
  await startDailyIfNeeded(page);
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  const low = lowBracket(page);
  await low.focus();
  await page.keyboard.press('ArrowRight');
  await expect(low).toHaveAttribute('aria-valuenow', '41');
  await page.clock.fastForward('00:15');
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '41');
});

test('practice on an earlier day does not touch the daily record', async ({ page }) => {
  await openAt(page, DAY2);
  for (let i = 0; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.stats')).toContainText('Played1');
  await page.getByRole('button', { name: 'Nov 15' }).click();
  await startDailyIfNeeded(page);
  await expect(page.locator('.round-meta')).toContainText('Practice');
  for (let i = 0; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-head')).toContainText('not counted');
  await page.getByRole('button', { name: 'Play today’s puzzle' }).click();
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
  await expect(page.locator('.round-meta')).toContainText('Question 2 of 5');
  expect(errors).toEqual([]);
});

test('corrupted save data is set aside instead of crashing', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('stat-window:v1', '{"version":1,"runs":{"2026-11-15":{"results":"nope"}}}'));
  await openAt(page, DAY1);
  await expect(page.locator('.round-meta')).toContainText('Question 1 of 5');
});
