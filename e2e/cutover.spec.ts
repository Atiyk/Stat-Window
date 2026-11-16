import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { collectErrors, lockAndSettle, NBA_CUTOVER, NBA_DAYS, next, openAt } from './helpers';

/**
 * The move from the mixed-sport launch days to the NBA calendar. Dates come from
 * data/nba/calendar.json, so these keep testing the real boundary after a reschedule.
 */
const dayBefore = new Date(Date.parse(`${NBA_CUTOVER}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const firstNba = JSON.parse(readFileSync(new URL(`../content/days/${NBA_CUTOVER}.json`, import.meta.url), 'utf8')) as {
  theme: { title: string };
  questions: { prompt: string }[];
};
const lastMixed = JSON.parse(readFileSync(new URL(`../content/days/${dayBefore}.json`, import.meta.url), 'utf8')) as {
  theme?: unknown;
  questions: { prompt: string }[];
};

async function playOut(page: import('@playwright/test').Page, from = 0) {
  for (let i = from; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-score')).toBeVisible();
}

test('the last mixed-sport day is unthemed and the cutover day is the first NBA day', () => {
  expect(lastMixed.theme).toBeUndefined();
  expect(NBA_DAYS[0]).toBe(NBA_CUTOVER);
  expect(NBA_DAYS).toHaveLength(50);
});

test('an unfinished mixed-sport run at midnight is finished on its own day, then the NBA day opens', async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.install({ time: new Date(`${dayBefore}T23:58:00Z`) });
  await page.goto('/');
  await expect(page.locator('.question')).toContainText(lastMixed.questions[0]!.prompt);
  await lockAndSettle(page);
  await next(page);
  await page.clock.fastForward('04:00');
  await expect(page.locator('.round-meta')).toContainText('Round 2 of 5');
  await expect(page.locator('.question')).toContainText(lastMixed.questions[1]!.prompt);
  await expect(page.locator('.theme-line')).toHaveCount(0);
  await playOut(page, 1);
  await page.getByRole('button', { name: 'Play today’s puzzle' }).click();
  await expect(page.locator('.theme-line')).toHaveText(firstNba.theme.title);
  await expect(page.locator('.question')).toContainText(firstNba.questions[0]!.prompt);
  expect(errors).toEqual([]);
});

test('a tab idle on the finished mixed day moves to the NBA day at midnight', async ({ page }) => {
  await page.clock.install({ time: new Date(`${dayBefore}T23:50:00Z`) });
  await page.goto('/');
  await expect(page.locator('.question')).toBeVisible();
  await playOut(page);
  await page.clock.fastForward('11:00');
  await expect(page.locator('.theme-line')).toHaveText(firstNba.theme.title);
});

test('after the cutover, a friend link to a mixed-sport day still plays that day, and the archive labels it', async ({ page }) => {
  const errors = collectErrors(page);
  await openAt(page, new Date(`${NBA_CUTOVER}T12:00:00Z`), `/?day=${dayBefore}&vs=210`);
  await expect(page.locator('.challenge-note')).toContainText('210');
  await expect(page.locator('.question')).toContainText(lastMixed.questions[0]!.prompt);
  await playOut(page);
  await expect(page.locator('.versus')).toBeVisible();
  await expect(page.locator('.archive-list')).toContainText('mixed sports');
  expect(errors).toEqual([]);
});

test('on the cutover day, a link to the next NBA day is refused as a future day', async ({ page }) => {
  await openAt(page, new Date(`${NBA_CUTOVER}T12:00:00Z`), `/?day=${NBA_DAYS[1]}&vs=300`);
  await expect(page.locator('.theme-line')).toHaveText(firstNba.theme.title);
  await expect(page.locator('.challenge-note')).toHaveCount(0);
});

test('a tab from before a deploy reloads once when its day file has gone, then plays', async ({ page }) => {
  let refused = 0;
  await page.route(/\/assets\/\d{4}-\d{2}-\d{2}-[^/]+\.js$/, async (route) => {
    if (refused === 0) {
      refused++;
      return route.fulfill({ status: 404, body: 'gone' });
    }
    return route.continue();
  });
  await page.clock.setFixedTime(new Date(`${NBA_CUTOVER}T12:00:00Z`));
  await page.goto('/');
  await expect(page.locator('.theme-line')).toHaveText(firstNba.theme.title);
  expect(refused).toBe(1);
});

test('a day file that stays missing does not reload forever', async ({ page }) => {
  let loads = 0;
  page.on('load', () => loads++);
  await page.route(/\/assets\/\d{4}-\d{2}-\d{2}-[^/]+\.js$/, (route) => route.fulfill({ status: 404, body: 'gone' }));
  await page.clock.setFixedTime(new Date(`${NBA_CUTOVER}T12:00:00Z`));
  await page.goto('/');
  await expect(page.locator('.results-title')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(loads).toBeLessThanOrEqual(2);
});
