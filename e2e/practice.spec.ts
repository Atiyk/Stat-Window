import { expect, test, type Page } from '@playwright/test';
import { addDays, puzzleDay } from '../src/engine/daily';
import { SAVE_KEY, UNTIMED_PRACTICE_KEY } from '../src/engine/storage';
import { DAY1, DAY2, lockAndSettle, NBA_LAST, next, openAt, startDailyIfNeeded, typeWindow } from './helpers';

const earlierDay = '2026-11-15';
const practicePath = `/?practice=${earlierDay}`;
type Run = { results: { points: number; elapsedMs?: number; timedOut?: boolean }[]; advanced: number };
type Save = { runs: Record<string, Run>; practice?: Record<string, Run>; untimedPractice?: Record<string, Run> };

const saved = (page: Page) => page.evaluate(([dailyKey, untimedKey]) => {
  const daily = JSON.parse(window.localStorage.getItem(dailyKey) ?? '{}') as Save;
  const untimed = JSON.parse(window.localStorage.getItem(untimedKey) ?? '{}') as Save;
  return { ...daily, untimedPractice: untimed.practice };
}, [SAVE_KEY, UNTIMED_PRACTICE_KEY] as const);

async function startUntimed(page: Page) {
  await expect(page.locator('.ready-card .context')).toHaveText('Untimed practice');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.locator('.round-meta')).toContainText('Untimed practice');
  await expect(page.getByRole('timer')).toHaveCount(0);
}

test.use({ reducedMotion: 'reduce' });

test('untimed practice restores its round, scores normally and stays outside official results', async ({ page }) => {
  await page.clock.install({ time: DAY1 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => {
      document.body.dataset.practiceShare = text;
    } } });
  });
  await page.goto('/');
  await startDailyIfNeeded(page);
  await expect(page.getByRole('timer')).toBeVisible();
  await lockAndSettle(page);
  const official = (await saved(page)).runs[earlierDay];
  expect(official?.results[0]?.elapsedMs).toBeDefined();

  await page.clock.setFixedTime(DAY2);
  const competition: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(?:scores|leaderboard)\b/.test(request.url())) competition.push(request.url());
  });
  await page.goto(practicePath);
  await startUntimed(page);
  await page.reload(); // Restore Start even before any locked result.
  await expect(page.locator('.round-meta')).toContainText('Question 1 of 5');
  await page.clock.fastForward(30_000);
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.locator('.story')).toHaveCount(0);

  await typeWindow(page, 72, 73);
  await lockAndSettle(page);
  await page.reload(); // A lock restores its reveal at the same score.
  await expect(page.getByRole('status')).toContainText('100 points');
  await next(page);
  for (let i = 1; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-context')).toContainText('Untimed practice');
  await expect(page.locator('.results-time, .versus, .stats')).toHaveCount(0);
  const completed = await saved(page);
  expect(completed.runs).toEqual({ [earlierDay]: official });
  expect(completed.untimedPractice?.[earlierDay]).toMatchObject({ advanced: 5 });
  expect(completed.untimedPractice?.[earlierDay]?.results).toHaveLength(5);
  for (const round of completed.untimedPractice![earlierDay]!.results) {
    expect(round.elapsedMs).toBeUndefined();
    expect(round.timedOut).toBeUndefined();
  }
  expect(competition).toEqual([]);
  await page.getByRole('button', { name: 'Share practice score' }).click();
  await expect(page.locator('.toast')).toHaveText('Copied');
  const shared = await page.locator('body').getAttribute('data-practice-share');
  expect(shared).toContain('Untimed practice');
  expect(shared?.split('\n').at(-1)).toMatch(/\?day=2026-11-15$/);
  expect(shared).not.toContain('Can you beat');

  await page.reload();
  await expect(page.locator('.results-context')).toContainText('Untimed practice');
  await page.getByRole('button', { name: 'Play today’s puzzle' }).click();
  await startDailyIfNeeded(page);
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('mode selection keeps timed practice separate and supports browser back and forward', async ({ page }) => {
  const noPuzzle = addDays(puzzleDay(NBA_LAST), 1);
  await page.clock.setFixedTime(new Date(`${noPuzzle}T15:00:00Z`));
  await page.goto('/');
  await expect(page.getByRole('radio', { name: 'Timed', exact: true })).toBeChecked();
  const day = page.getByRole('button', { name: /^Nov 15(?:\s|$)/ });
  await day.click();
  await startDailyIfNeeded(page);
  await expect(page.getByRole('timer')).toBeVisible();
  await lockAndSettle(page);
  await next(page);
  const timedRun = (await saved(page)).practice?.[earlierDay];
  expect(timedRun?.results).toHaveLength(1);

  await page.reload();
  await page.getByRole('radio', { name: 'Untimed', exact: true }).check();
  await day.click();
  await expect(page).toHaveURL(/\?practice=2026-11-15$/);
  await startUntimed(page);
  await expect(page.locator('.round-meta')).toContainText('Question 1 of 5');
  await page.goBack();
  await expect(page.getByRole('radio', { name: 'Timed', exact: true })).toBeChecked();
  await page.goForward();
  await expect(page.locator('.round-meta')).toContainText('Untimed practice');
  expect((await saved(page)).practice?.[earlierDay]).toEqual(timedRun);
});

test('cross-tab practice progress survives Eastern midnight without opening a new day', async ({ page, context }) => {
  const before = new Date('2026-11-17T04:59:50Z');
  await page.clock.setFixedTime(before);
  await page.goto(practicePath);
  await startUntimed(page);
  const second = await context.newPage();
  await second.clock.setFixedTime(before);
  await second.goto(practicePath);
  await startUntimed(second);

  await typeWindow(page, 72, 73);
  await lockAndSettle(page);
  await expect(second.getByRole('status')).toContainText('100 points');
  await next(second);
  await second.clock.setFixedTime(new Date('2026-11-17T05:00:05Z'));
  await second.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(second).toHaveURL(/\?practice=2026-11-15$/);
  await expect(second.locator('.round-meta')).toContainText('Question 2 of 5');
  await expect(second.getByRole('timer')).toHaveCount(0);
  expect((await saved(second)).runs).toEqual({});
});

test('today and future puzzles reject practice links and legacy challenges stay timed', async ({ page }) => {
  await openAt(page, DAY2, '/?practice=2026-11-16');
  await expect(page.locator('.question')).toContainText('Barry Bonds');
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await openAt(page, DAY2, '/?practice=2026-11-17');
  await expect(page.locator('.question')).toContainText('Barry Bonds');
  await expect(page.getByRole('timer')).toBeVisible();
  await openAt(page, DAY2, `/?day=${earlierDay}&vs=120&practice=${earlierDay}`);
  await expect(page.locator('.challenge-note')).toContainText('120');
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page).toHaveURL(/\?day=2026-11-15&vs=120$/);
});

test('an untimed lock that races a saved result displays the first saved window', async ({ page }) => {
  await page.clock.setFixedTime(DAY2);
  await page.goto(practicePath);
  await startUntimed(page);
  await typeWindow(page, 72, 73);

  // Simulate a different tab winning at the instant of the lock, before this tab
  // can receive a storage event. The next save must use the persisted result.
  await page.evaluate(([key, day]) => {
    const firstLock = { questionId: 'nba-gsw-2016-wins', lo: 60, hi: 61, hit: false, points: 0, missBy: 12 };
    const data = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    data.practice[day] = { results: [firstLock], advanced: 0 };
    window.localStorage.setItem(key, JSON.stringify(data));
  }, [UNTIMED_PRACTICE_KEY, earlierDay] as const);
  await lockAndSettle(page);
  await expect(page.getByRole('status')).toContainText('0 points');
  await expect(page.locator('.outcome')).toContainText('12 wins');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('0 points');
});
