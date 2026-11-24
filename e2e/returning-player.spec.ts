import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parseSlate } from '../src/content/schema';
import { totalPoints } from '../src/engine/game';
import { scoreWindow } from '../src/engine/scoring';
import { SAVE_KEY, type SaveData } from '../src/engine/storage';

const yesterday = '2026-11-23';
const today = new Date('2026-11-24T15:00:00Z');
const slate = parseSlate(JSON.parse(readFileSync(new URL(`../content/days/${yesterday}.json`, import.meta.url), 'utf8')));
const results = slate.questions.map((q) => {
  const window = { lo: Math.max(q.min, q.answer - q.step), hi: Math.min(q.max, q.answer + q.step) };
  return { questionId: q.id, ...window, ...scoreWindow(q, window) };
});
const completed = { results, advanced: results.length };

async function openReady(page: Page, runs: SaveData['runs'], practice?: SaveData['practice'], introSeen = true) {
  await page.clock.setFixedTime(today);
  await page.addInitScript(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY,
    save: { version: 1, runs, practice, settings: { sound: false, introSeen } },
  });
  await page.goto('/');
}

test('yesterday’s completed daily score appears under the deliberate Start', async ({ page }) => {
  await openReady(page, { [yesterday]: completed });
  await expect(page.locator('.ready-previous')).toHaveText(`Yesterday: ${totalPoints(results)} / 500`);
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.locator('.question')).toHaveCount(0);
  await page.getByRole('button', { name: "Start today's five" }).click();
  await expect(page.getByRole('timer')).toHaveText('24s');
  await expect(page.locator('.ready-previous')).toHaveCount(0);
});

for (const [scenario, runs, practice] of [
  ['no history', {}, undefined],
  ['practice history only', {}, { [yesterday]: completed }],
  ['a final reveal awaiting advance', { [yesterday]: { ...completed, advanced: 4 } }, undefined],
] as const) {
  test(`the ready screen shows no previous score with ${scenario}`, async ({ page }) => {
    await openReady(page, runs, practice);
    await expect(page.getByRole('heading', { name: 'Ready for five?' })).toBeVisible();
    await expect(page.locator('.ready-previous')).toHaveCount(0);
  });
}

for (const [scenario, rewrite] of [
  ['stale question IDs', (r: typeof results[number]) => ({ ...r, questionId: 'stale' })],
  ['incorrect stored points', (r: typeof results[number]) => ({ ...r, points: 0 })],
] as const) {
  test(`the ready screen omits a completed run with ${scenario}`, async ({ page }) => {
    const historicalSlate = page.waitForResponse(new RegExp(`/(assets/${yesterday}-[^/]+\\.js|content/days/${yesterday}\\.json)(\\?.*)?$`));
    await openReady(page, { [yesterday]: { ...completed, results: results.map(rewrite) } });
    await (await historicalSlate).finished();
    await expect(page.getByRole('heading', { name: 'Ready for five?' })).toBeVisible();
    await expect(page.locator('.ready-previous')).toHaveCount(0);
  });
}

test('the fresh tutorial shows no score acknowledgment', async ({ page }) => {
  await openReady(page, { [yesterday]: completed }, undefined, false);
  await expect(page.getByRole('button', { name: 'Skip tutorial and start' })).toBeVisible();
  await expect(page.locator('.ready-previous')).toHaveCount(0);
});
