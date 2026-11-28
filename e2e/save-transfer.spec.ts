import { expect, test, type BrowserContext } from '@playwright/test';
import { CANONICAL_ORIGIN, LEGACY_ORIGIN } from '../src/lib/site';
import { emptySave, SAVE_KEY, sharedShotKey, shotSessionKey } from '../src/engine/storage';
import { highBracket, lowBracket, startDailyIfNeeded } from './helpers';

const day = '2026-11-29';
const now = new Date(day + 'T15:00:00Z');
const questionId = 'nba-bulls11-regular-wins';
const sharedClock = sharedShotKey(day, questionId);
const tabClock = shotSessionKey('daily', questionId);

// Use the real production origins with the candidate's assets and isolated browser storage.
async function serveOrigins(context: BrowserContext, baseURL: string) {
  await context.route((url) => [CANONICAL_ORIGIN, LEGACY_ORIGIN].includes(url.origin), async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: new URL(url.pathname + url.search, baseURL).href });
    await route.fulfill({ response });
  });
}

test('legacy challenge entry preserves its query and opens the branded site', async ({ context, page, baseURL }) => {
  await serveOrigins(context, baseURL!);
  await page.clock.setFixedTime(now);
  await page.goto(LEGACY_ORIGIN + '/?day=' + day + '&vs=245&utm_source=friend');
  await expect(page).toHaveURL(CANONICAL_ORIGIN + '/?day=' + day + '&vs=245&utm_source=friend');
  await startDailyIfNeeded(page);
  await expect(page.locator('.challenge-note')).toContainText('245');
});

test('branded reminder entry can import Vercel history and resume the original clock', async ({ context, page, baseURL }) => {
  await serveOrigins(context, baseURL!);
  await page.clock.setFixedTime(now);
  const previous = {
    results: [{ questionId: 'saved-beta-question', lo: 1, hi: 2, points: 50, hit: true, missBy: 0 }],
    advanced: 1,
  };
  const saved = {
    ...emptySave(),
    runs: {
      '2026-11-27': previous,
      [day]: { results: [], advanced: 0, guess: { questionId, round: 0, lo: 59, hi: 65 } },
    },
  };
  const startedAt = now.getTime() - 10_000;
  await page.addInitScript(({ legacy, saveKey, saved, sharedClock, tabClock, startedAt }) => {
    if (location.origin !== legacy) return;
    // Seed an old tab the first time the test enters the Vercel origin.
    if (localStorage.getItem(saveKey)) return;
    localStorage.setItem(saveKey, JSON.stringify(saved));
    localStorage.setItem(sharedClock, String(startedAt));
    sessionStorage.setItem(tabClock, String(startedAt));
  }, { legacy: LEGACY_ORIGIN, saveKey: SAVE_KEY, saved, sharedClock, tabClock, startedAt });

  await page.goto(CANONICAL_ORIGIN + '/?from=calendar&qa=1');
  const importLink = page.getByRole('link', { name: 'Import Vercel saves' });
  await expect(importLink).toBeVisible();
  await importLink.click();
  await expect(page).toHaveURL(LEGACY_ORIGIN + '/?qa=1');
  const nextTab = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Move saved games' }).click();
  const branded = await nextTab;
  await expect(branded).toHaveURL(CANONICAL_ORIGIN + '/?qa=1');
  await expect(lowBracket(branded)).toHaveAttribute('aria-valuenow', '59');
  await expect(highBracket(branded)).toHaveAttribute('aria-valuenow', '65');
  await expect(branded.getByRole('timer')).toContainText('14s');
  const progress = await branded.evaluate(({ key, clock }) => ({
    runs: JSON.parse(localStorage.getItem(key)!).runs,
    timestamp: sessionStorage.getItem(clock),
  }), { key: SAVE_KEY, clock: tabClock });
  expect(progress.runs).toEqual(saved.runs);
  expect(progress.timestamp).toBe(String(startedAt));

  // After the acknowledged transfer, old entry links go straight to the same run.
  await expect(page.getByRole('status')).toContainText('open in the new tab');
  await page.goto(LEGACY_ORIGIN + '/?from=calendar&qa=1');
  await expect(page).toHaveURL(CANONICAL_ORIGIN + '/?qa=1');
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '59');
  await expect(page.getByRole('timer')).toContainText('14s');
});
