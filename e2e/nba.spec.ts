import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { collectErrors, DAY1, lockAndSettle, NBA_FIRST, NBA_LAST, NBA_MIDDLE, next, openAt } from './helpers';

type Day = { date: string; theme: { title: string; recap: string }; questions: { answer: number; difficulty: string }[] };
const load = (day: string) => JSON.parse(readFileSync(new URL(`../content/days/${day}.json`, import.meta.url), 'utf8')) as Day;
const LADDER = ['Easy', 'Medium', 'Hard', 'Hard', 'Expert'];

for (const when of [NBA_FIRST, NBA_MIDDLE, NBA_LAST]) {
  const day = when.toISOString().slice(0, 10);
  test(`NBA day ${day}: themed, climbs Easy to Expert, sources on Wikipedia, recap after play`, async ({ page }) => {
    const errors = collectErrors(page);
    const slate = load(day);
    await openAt(page, when);
    for (let i = 0; i < 5; i++) {
      await expect(page.locator('.theme-line')).toHaveText(slate.theme.title);
      await expect(page.locator('.round-meta')).toContainText(`Round ${i + 1} of 5 · ${LADDER[i]}`);
      await expect(page.locator('.context')).toContainText('NBA ·');
      await lockAndSettle(page);
      const href = await page.locator('.story-source a').getAttribute('href');
      expect(new URL(href!).host).toBe('en.wikipedia.org');
      await expect(page.locator('.story-source')).toContainText('Wikipedia contributors (CC BY-SA 4.0)');
      await next(page);
    }
    await expect(page.locator('.results-head .context')).toContainText(slate.theme.title);
    await expect(page.locator('.theme-recap')).toHaveText(slate.theme.recap);
    await expect(page.locator('.recap-row')).toHaveCount(5);
    expect(errors).toEqual([]);
  });
}

test('a save from before the NBA cutover still loads, and its day still plays the original slate', async ({ page }) => {
  await openAt(page, DAY1);
  await lockAndSettle(page);
  await next(page);
  // Later, the first NBA day opens fresh and the launch-day run is kept.
  await openAt(page, NBA_FIRST);
  await expect(page.locator('.round-meta')).toContainText('Round 1 of 5 · Easy');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') ?? '{}'));
  expect(Object.keys(saved.runs ?? {})).toContain('2026-11-15');
  expect(saved.runs['2026-11-15'].results).toHaveLength(1);
});
