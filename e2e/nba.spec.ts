import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { collectErrors, DAY1, lockAndSettle, NBA_FIRST, NBA_LAST, NBA_MIDDLE, next, openAt } from './helpers';

type Day = { date: string; theme: { title: string; recap: string }; questions: { answer: number; difficulty: string }[] };
const load = (day: string) => JSON.parse(readFileSync(new URL(`../content/days/${day}.json`, import.meta.url), 'utf8')) as Day;
const LABELS = /\b(Easy|Medium|Hard|Expert)\b/;

for (const when of [NBA_FIRST, NBA_MIDDLE, NBA_LAST]) {
  const day = when.toISOString().slice(0, 10);
  test(`NBA day ${day}: plain question count, first-round theme, no difficulty shown, sources one tap away`, async ({ page }) => {
    const errors = collectErrors(page);
    const slate = load(day);
    // The ladder and theme are still in the content for editors and validators.
    expect(slate.questions.map((q) => q.difficulty)).toEqual(['easy', 'medium', 'hard', 'hard', 'expert']);
    expect(slate.theme.title.length).toBeGreaterThan(1);
    await openAt(page, when);
    for (let i = 0; i < 5; i++) {
      await expect(page.locator('.round-meta')).toContainText(`Question ${i + 1} of 5`);
      await expect(page.locator('.round')).not.toContainText(LABELS);
      if (i === 0) await expect(page.locator('.puzzle-theme')).toContainText(slate.theme.title);
      else await expect(page.locator('.puzzle-theme')).toHaveCount(0);
      await expect(page.locator('.context')).toContainText('NBA ·');
      await lockAndSettle(page);
      // Credit is visible without opening anything; the licence and links are in the disclosure.
      const sources = page.locator('.sources');
      await expect(sources.locator('summary')).toContainText('Sources & method');
      await expect(sources.locator('summary')).toContainText('Wikipedia');
      await sources.locator('summary').click();
      const href = await sources.locator('a').first().getAttribute('href');
      expect(new URL(href!).host).toBe('en.wikipedia.org');
      await expect(sources).toContainText('Wikipedia contributors');
      await expect(sources.getByRole('link', { name: /CC BY-SA 4\.0/ }).first()).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
      await expect(page.locator('.story-reaction')).toHaveText(/\.$/);
      await next(page);
    }
    await expect(page.locator('.results-head')).not.toContainText(slate.theme.title);
    await expect(page.locator('.theme-recap')).toHaveCount(0);
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
  await expect(page.locator('.round-meta')).toHaveText(/^Question\s1 of\s5/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') ?? '{}'));
  expect(Object.keys(saved.runs ?? {})).toContain('2026-11-15');
  expect(saved.runs['2026-11-15'].results).toHaveLength(1);
});
