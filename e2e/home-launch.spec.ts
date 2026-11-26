import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parseSlate } from '../src/content/schema';
import { normalizeWindow } from '../src/engine/game';
import { scoreWindow } from '../src/engine/scoring';
import { SAVE_KEY } from '../src/engine/storage';
import { lockAndSettle, next, startDailyIfNeeded } from './helpers';

// Launch-preview QA build only (see playwright.config.ts LAUNCH_E2E and e2e/launch.spec.ts).
test.skip(!process.env.LAUNCH_E2E, 'requires the isolated launch-preview QA build');

const LAUNCH = '2026-12-02'; // a Wednesday: a midweek launch
const preview = `launch-preview=${LAUNCH}`;
const at = (iso: string) => new Date(iso);
const noScores = (page: Page) => page.route('**/api/scores**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"status":"disabled"}' }));

async function play(page: Page) {
  await startDailyIfNeeded(page);
  for (let i = 0; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-score')).toBeVisible();
}

function betaRun(day: string) {
  const slate = parseSlate(JSON.parse(readFileSync(new URL(`../content/days/${day}.json`, import.meta.url), 'utf8')));
  const results = slate.questions.map((q) => {
    const window = normalizeWindow(q, { lo: q.answer - q.step, hi: q.answer + q.step });
    return { questionId: q.id, ...window, ...scoreWindow(q, window) };
  });
  return { results, advanced: 5 };
}

test('Day 1: honest practice state, no empty stats, then genuine weekly progress with the midweek ceiling', async ({ page }) => {
  await noScores(page);
  // Beta play the day before launch must not show up anywhere in the new season.
  await page.addInitScript(({ key, save }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save)); }, {
    key: SAVE_KEY, save: { version: 1, runs: { '2026-12-01': betaRun('2026-12-01') }, settings: { sound: false, introSeen: true } },
  });
  await page.clock.setFixedTime(at('2026-12-02T15:00:00Z'));
  await page.goto(`/?${preview}`);
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await expect(page.getByRole('heading', { name: 'Ready for five?' })).toBeVisible();
  await expect(page.locator('.home-more__empty')).toContainText('Opens tomorrow');
  await expect(page.getByRole('button', { name: /Scouting Report/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Weekly Scoreboard/ })).toHaveCount(0);
  await expect(page.locator('.week-glance')).toHaveCount(0);
  await expect(page.getByText('Survival')).toHaveCount(0);

  await play(page);
  await expect(page.locator('.week-glance')).toContainText('1 of 5 games');
  await page.getByRole('button', { name: 'Weekly Scoreboard' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nov 30 – Dec 6, 2026');
  const rows = page.locator('.week-row');
  await expect(rows.nth(0)).toContainText('Before the season began');
  await expect(rows.nth(1)).toContainText('Before the season began'); // Dec 1 beta play is not eligible
  await expect(rows.nth(2)).not.toContainText('Before');
  await expect(page.locator('.weekly__stats')).toContainText('1 of 5');
  await expect(page.locator('.weekly__stats')).toContainText('of 2,500 possible');
  await expect(page.getByRole('button', { name: 'Last week' })).toHaveCount(0); // nothing eligible before launch
  await page.getByRole('button', { name: /Today’s puzzle/ }).click();
  await expect(page.locator('.results-score')).toBeVisible();
});

test('Day 2: practice now lists Day 1, and the previous day is yesterday’s eligible game', async ({ page }) => {
  await noScores(page);
  await page.clock.setFixedTime(at('2026-12-02T15:00:00Z'));
  await page.goto(`/?${preview}`);
  await play(page);
  await page.clock.setFixedTime(at('2026-12-03T15:00:00Z'));
  await page.goto(`/?${preview}`);
  await expect(page.locator('.day-label')).toHaveText('No. 2');
  await expect(page.locator('.home-more__empty')).toHaveCount(0);
  await expect(page.locator('.week-glance')).toContainText('1 of 5 games');
  await page.getByRole('button', { name: /^Practice/ }).click();
  await expect(page.locator('.home-practice .archive-list button')).toHaveCount(1);
  await expect(page.locator('.home-practice .archive-list button')).toContainText('Dec 2');
  await expect(page.getByRole('button', { name: /Scouting Report/ })).toBeVisible();
});

test('midnight Eastern: an idle results screen becomes the new day’s home and the week strip follows', async ({ page }) => {
  await noScores(page);
  await page.clock.install({ time: at('2026-12-03T04:59:20Z') }); // 11:59:20 PM EST on launch day
  await page.goto(`/?${preview}`);
  await play(page);
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await page.clock.fastForward('01:00');
  await expect(page.locator('.day-label')).toHaveText('No. 2');
  await expect(page.getByRole('heading', { name: 'Ready for five?' })).toBeVisible();
  await expect(page.locator('.week-glance')).toContainText('1 of 5 games');
  await expect(page.locator('.week-strip__day[data-state="open"]')).toHaveCount(1);
});

test('the week rolls over on Monday: last week stays reviewable', async ({ page }) => {
  await noScores(page);
  await page.clock.setFixedTime(at('2026-12-04T15:00:00Z'));
  await page.goto(`/?${preview}`);
  await play(page);
  await page.clock.setFixedTime(at('2026-12-07T15:00:00Z')); // Monday
  await page.goto(`/?${preview}&weekly`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dec 7 – Dec 13, 2026');
  await expect(page.locator('.weekly__stats')).toContainText('0 of 7');
  await page.getByRole('button', { name: 'Last week' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nov 30 – Dec 6, 2026');
  await expect(page.locator('.weekly__stats')).toContainText('1 of 5');
});
