import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { collectErrors, DAY1, lockAndSettle, NBA_FIRST, NBA_LAST, NBA_MIDDLE, next, openAt } from './helpers';

type Day = { date: string; theme: { title: string; recap: string }; questions: { id: string; answer: number; difficulty: string; context: string; funFacts?: unknown[] }[] };
const categories = JSON.parse(readFileSync(new URL('../src/content/nba-categories.json', import.meta.url), 'utf8')) as Record<string, string>;
const load = (day: string) => JSON.parse(readFileSync(new URL(`../content/days/${day}.json`, import.meta.url), 'utf8')) as Day;
const LABELS = /\b(Easy|Medium|Hard|Expert)\b/;

for (const when of [NBA_FIRST, NBA_MIDDLE, NBA_LAST]) {
  const day = when.toISOString().slice(0, 10);
  test(`NBA day ${day}: each round has its own category, with no sources in gameplay`, async ({ page }) => {
    const errors = collectErrors(page);
    const slate = load(day);
    // The ladder and theme are still in the content for editors and validators.
    expect(slate.questions.map((q) => q.difficulty)).toEqual(['easy', 'medium', 'hard', 'hard', 'expert']);
    expect(slate.theme.title.length).toBeGreaterThan(1);
    await openAt(page, when);
    for (let i = 0; i < 5; i++) {
      await expect(page.locator('.round-meta')).toContainText(`Question ${i + 1} of 5`);
      await expect(page.locator('.round')).not.toContainText(LABELS);
      await expect(page.locator('.question-block .context')).toHaveText(categories[slate.questions[i]!.id]!);
      await expect(page.locator('.puzzle-theme, .theme-subtitle')).toHaveCount(0);
      await lockAndSettle(page);
      await expect(page.locator('.sources, .story-extra-title')).toHaveCount(0);
      await expect(page.locator('.story-extra-text')).toHaveCount(slate.questions[i]!.funFacts?.length ? 1 : 0);
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
