import { expect, test, type Page } from '@playwright/test';
import { lockAndSettle, next, startDailyIfNeeded } from './helpers';
import { addDays, puzzleNumber, puzzleStartUtcMs } from '../src/engine/daily';
import { LAUNCH_DAY } from '../src/engine/launch-config';

// This suite uses a separate VITE_LAUNCH_PREVIEW=1 build, never the live beta
// or a production deployment. It proves the V3 fresh-Day-1 user contract.
test.skip(!process.env.LAUNCH_E2E, 'requires the isolated launch-preview QA build');

const LAUNCH = '2027-01-10';
const before = '2027-01-09T15:00:00Z';
const first = '2027-01-10T15:00:00Z';
const second = '2027-01-11T15:00:00Z';
const preview = `launch-preview=${LAUNCH}`;

async function at(page: Page, iso: string | Date, path: string) {
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
  await expect(page.locator('.day-label')).not.toHaveText('Game 1');
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
  await expect(page.locator('.day-label')).toHaveText('Game 1');
  await expect(page.getByRole('heading', { name: 'How well do you know ball?' })).toBeVisible();
  await expect(page.locator('.ready-previous')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await complete(page);
  await expect(page.locator('.stats dt', { hasText: 'Played' }).locator('..').locator('dd')).toHaveText('1');
  await expect(page.locator('.archive-list')).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') ?? '{}'));
  expect(Object.keys(saved.runs)).toContain('2027-01-09');
  expect(Object.keys(saved.runs)).toContain(LAUNCH);

  await at(page, second, `/?${preview}`);
  const firstScore = saved.runs[LAUNCH].results.reduce((total: number, round: { points: number }) => total + round.points, 0);
  await expect(page.locator('.ready-previous')).toHaveText(`Yesterday: ${firstScore} / 500`);
});

test('a retired beta challenge gives an explicit notice and strips its score/time link', async ({ page }) => {
  await at(page, first, `/?day=2027-01-09&vs=300&time=1234&${preview}`);
  await expect(page.getByRole('status').filter({ hasText: 'beta puzzle was retired' })).toBeVisible();
  await expect(page.locator('.day-label')).toHaveText('Game 1');
  const params = new URLSearchParams(new URL(page.url()).search);
  expect(params.has('day')).toBe(false);
  expect(params.has('vs')).toBe(false);
  expect(params.has('time')).toBe(false);
  expect(params.get('launch-preview')).toBe(LAUNCH);
  await startDailyIfNeeded(page);
  await expect(page.locator('.question')).toBeVisible();
  await expect(page.locator('.challenge-note')).toHaveCount(0);
});

test('retirement switches at Eastern midnight, not UTC midnight', async ({ page }) => {
  const legacy = `/?day=2027-01-09&vs=300&${preview}`;
  // Jan 10 04:59 UTC is still January 9 in New York (EST).
  await at(page, '2027-01-10T04:59:59Z', legacy);
  await startDailyIfNeeded(page);
  await expect(page.locator('.challenge-note')).toContainText('300');

  // At 05:00Z the New York puzzle day rolls over and the beta link retires.
  await at(page, '2027-01-10T05:00:00Z', legacy);
  await expect(page.locator('.link-note')).toContainText('beta puzzle was retired');
  await expect(page.locator('.day-label')).toHaveText('Game 1');
  await expect(page.locator('.challenge-note')).toHaveCount(0);
});

test('Day 2 archive contains only Day 1, and new-season challenge links remain playable', async ({ page }) => {
  await at(page, second, `/?${preview}`);
  await expect(page.locator('.day-label')).toHaveText('Game 2');
  await complete(page);
  const buttons = page.locator('.archive-list button');
  await expect(buttons).toHaveCount(1);
  await expect(buttons.first()).toContainText('Jan 10');

  await at(page, second, `/?day=${LAUNCH}&vs=250&${preview}`);
  await startDailyIfNeeded(page);
  await expect(page.locator('.day-label')).toHaveText('Game 1');
  await expect(page.locator('.challenge-note')).toContainText('250');
  await expect(page.locator('.link-note')).toHaveCount(0);
});

test('November 28 candidate becomes an official Day 1 without beta scores or stale challenge metadata', async ({ page }) => {
  const launchDay = '2026-11-28';
  // Make a real beta save first. The launch can hide this run but must not delete it.
  await at(page, '2026-11-27T15:00:00Z', `/?launch-preview=${launchDay}`);
  await complete(page);

  await at(page, '2026-11-28T15:00:00Z', `/?day=2026-11-27&vs=210&time=4800&launch-preview=${launchDay}`);
  await expect(page.locator('.link-note')).toContainText('beta puzzle was retired');
  await expect(page.locator('.day-label')).toHaveText('Game 1');
  const params = new URL(page.url()).searchParams;
  expect(params.has('day')).toBe(false);
  expect(params.has('vs')).toBe(false);
  expect(params.has('time')).toBe(false);

  await startDailyIfNeeded(page);
  await expect(page.locator('.question')).toBeVisible();
  await expect(page.locator('.question')).not.toContainText('How many regular-season games did the 2015');
  await expect(page.locator('.shot-clock')).toContainText('24s');
  await complete(page);
  await expect(page.locator('.archive-list')).toHaveCount(0);
  await expect(page.locator('.stats dt', { hasText: 'Played' }).locator('..').locator('dd')).toHaveText('1');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') ?? '{}'));
  expect(Object.keys(saved.runs)).toContain('2026-11-27');
  expect(Object.keys(saved.runs)).toContain('2026-11-28');
});

// Simulate the committed cutover with its real slates, without a preview override.
test.describe('committed Day 1', () => {
  test.skip(LAUNCH_DAY === null, 'requires a committed season');
  const launch = LAUNCH_DAY ?? '2026-11-28';
  const lastBeta = addDays(launch, -1);
  const betaLabel = `Game ${puzzleNumber(lastBeta)}`;
  const midnight = puzzleStartUtcMs(launch);
  const weekday = new Date(`${launch}T12:00:00Z`).getUTCDay();
  const launchWeekGames = weekday === 0 ? 1 : 8 - weekday;
  const dayAt = (offset: number) => new Date(puzzleStartUtcMs(addDays(launch, offset)) + 600_000);
  const total = (run: { results: { points: number }[] }) => run.results.reduce((s, r) => s + r.points, 0);

  test('counts the first four canonical games starting at midnight Eastern', async ({ page }) => {
    await at(page, new Date(midnight - 60_000), '/');
    await expect(page.locator('.day-label')).toHaveText(betaLabel);
    await at(page, new Date(midnight), '/');
    await expect(page.locator('.day-label')).toHaveText('Game 1');
    for (const offset of [1, 2, 3]) {
      await at(page, dayAt(offset), '/');
      await expect(page.locator('.day-label')).toHaveText(`Game ${offset + 1}`);
    }
  });

  test('players in Los Angeles and Tokyo get the same Game 1 and opening question', async ({ browser, baseURL }) => {
    const west = await browser.newContext({ baseURL, timezoneId: 'America/Los_Angeles' });
    const east = await browser.newContext({ baseURL, timezoneId: 'Asia/Tokyo' });
    try {
      const prompts = await Promise.all([west, east].map(async (context) => {
        const page = await context.newPage();
        await at(page, new Date(midnight), '/');
        await expect(page.locator('.day-label')).toHaveText('Game 1');
        await startDailyIfNeeded(page);
        return page.locator('.question').innerText();
      }));
      expect(prompts[0]).toBe(prompts[1]);
    } finally {
      await Promise.all([west.close(), east.close()]);
    }
  });

  test('beta play is kept but never counted: Day 1 stats, streak, weekly and share start from No. 1', async ({ page, context, browserName }) => {
    await at(page, dayAt(-1), '/');
    await expect(page.locator('.day-label')).toHaveText(betaLabel);
    await complete(page);

    await at(page, dayAt(0), '/');
    await expect(page.locator('.day-label')).toHaveText('Game 1');
    await expect(page.locator('.ready-previous')).toHaveCount(0);
    await startDailyIfNeeded(page);
    const firstPrompt = await page.locator('.question').innerText();
    // A refresh before locking reopens the same puzzle, not a re-rolled one.
    await page.reload();
    await startDailyIfNeeded(page);
    await expect(page.locator('.question')).toHaveText(firstPrompt);
    await complete(page);

    const stat = (name: string) => page.locator('.stats dt', { hasText: name }).locator('..').locator('dd');
    await expect(stat('Played')).toHaveText('1');
    await expect(stat('Days in a row')).toHaveText('1');
    await expect(page.locator('.archive-list')).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') ?? '{}'));
    expect(Object.keys(saved.runs).sort()).toEqual([lastBeta, launch]);
    const day1 = total(saved.runs[launch]);
    await expect(stat('Average')).toHaveText(String(day1));

    if (browserName === 'chromium' && test.info().project.name === 'desktop') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByRole('button', { name: 'Challenge a friend' }).click();
      const shared = await page.evaluate(() => navigator.clipboard.readText());
      expect(shared.split('\n')[0]).toMatch(new RegExp(`^Stat Window No\\. 1  ${day1}/500`));
      expect(shared).toContain(`/?day=${launch}&vs=`);
    }

    await at(page, dayAt(0), '/?weekly');
    await expect(page.locator('.week-summary__points')).toHaveText(day1.toLocaleString('en-US'));
    await expect(page.locator('.weekly__stats dt', { hasText: 'Games' }).locator('..').locator('dd')).toHaveText(`1 of ${launchWeekGames}`);
  });

  test('an old beta challenge link degrades with a notice on Day 1', async ({ page }) => {
    await at(page, dayAt(0), `/?day=${lastBeta}&vs=300&time=4000`);
    await expect(page.getByRole('status').filter({ hasText: 'beta puzzle was retired' })).toBeVisible();
    await expect(page.locator('.day-label')).toHaveText('Game 1');
    expect(new URL(page.url()).search).toBe('');
    await startDailyIfNeeded(page);
    await expect(page.locator('.challenge-note')).toHaveCount(0);
  });

  test('Day 2 archive holds only Day 1', async ({ page }) => {
    await at(page, dayAt(1), '/');
    await complete(page);
    const buttons = page.locator('.archive-list button');
    await expect(buttons).toHaveCount(1);
    const dateLabel = dayAt(0).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
    await expect(buttons.first()).toContainText(dateLabel);
  });

  async function openAcrossMidnight(page: Page) {
    await page.route('**/api/scores**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"status":"disabled"}' }));
    await page.clock.install({ time: new Date(midnight - 20_000) });
    await page.goto('/');
    await expect(page.locator('.day-label')).toHaveText(betaLabel);
    await page.evaluate(() => { (window as unknown as { sameDocument: boolean }).sameDocument = true; });
  }
  const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);

  test('an open tab crosses midnight onto Game 1 without a reload when launch.json agrees', async ({ page }) => {
    let checked = 0;
    await page.route('**/launch.json', async route => { checked++; await route.continue(); });
    await openAcrossMidnight(page);
    await page.clock.runFor(60_000);
    await expect(page.locator('.day-label')).toHaveText('Game 1');
    expect(checked).toBeGreaterThan(0);
    expect(await sameDocument(page)).toBe(true);
  });

  test('an open tab whose bundle disagrees with the deployed launch.json reloads at midnight', async ({ page }) => {
    // Simulates a tab opened before a deploy that changed the launch day.
    await page.route('**/launch.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"launchDay":null}' }));
    await openAcrossMidnight(page);
    const reloaded = page.waitForEvent('load');
    await page.clock.runFor(60_000);
    await reloaded;
    expect(await sameDocument(page)).toBe(false);
    // The reloaded bundle still has the committed schedule.
    await expect(page.locator('.day-label')).toHaveText('Game 1');
  });
});

test('Saturday launch has two eligible games and a streak that continues into the first full week', async ({ page }) => {
  const offer = 'launch-preview=2026-11-28';
  const sat = '2026-11-28T15:00:00Z';
  const sun = '2026-11-29T15:00:00Z';
  const mon = '2026-11-30T15:00:00Z';
  const games = page.locator('.weekly__stats dt', { hasText: 'Games' }).locator('..').locator('dd');
  for (const day of [sat, sun]) {
    await at(page, day, `/?${offer}`);
    await complete(page);
  }
  await at(page, sun, `/?weekly&${offer}`);
  await expect(games).toHaveText('2 of 2');
  await expect(page.locator('.week-summary__of')).toContainText('1,000 possible');
  await expect(page.locator('.week-record [data-state="before-season"]')).toHaveCount(5);
  await expect(page.locator('.week-record [data-state="unplayed"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Share this week' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Weekly scorecard image.*2 of 2 games played/ })).toBeVisible();

  await at(page, mon, `/?${offer}`);
  await expect(page.locator('.day-label')).toHaveText('Game 3');
  await complete(page);
  await expect(page.locator('.stats dt', { hasText: 'Days in a row' }).locator('..').locator('dd')).toHaveText('3');
  await at(page, mon, `/?weekly&${offer}`);
  await expect(games).toHaveText('1 of 7');
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(games).toHaveText('2 of 2');
});
