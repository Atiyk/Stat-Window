import { expect, test, type BrowserContext } from '@playwright/test';
import { CANONICAL_ORIGIN, LEGACY_ORIGIN } from '../src/lib/site';
import { emptySave, SAVE_KEY, sharedShotKey, shotSessionKey } from '../src/engine/storage';
import { highBracket, lowBracket, startDailyIfNeeded } from './helpers';
import { PRIVACY_KEY } from '../src/lib/privacy';

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
  await expect(page).toHaveURL(LEGACY_ORIGIN + '/?qa=1&import-saves=1');
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


test('privacy-only migration preserves opt-outs and does not replace a destination score identity', async ({ context, page, baseURL }) => {
  await serveOrigins(context, baseURL!);
  await page.clock.setFixedTime(now);
  let analyticsRequests = 0;
  await context.route('**/_vercel/insights/script.js', route => {
    analyticsRequests++;
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
  });
  const oldKey = 'A'.repeat(22);
  const newKey = 'B'.repeat(22);
  await context.addInitScript(({ legacy, canonical, key, oldKey, newKey }) => {
    if (localStorage.getItem(key)) return;
    if (location.origin === legacy) {
      localStorage.setItem(key, JSON.stringify({ analytics: 'off', scores: 'off', key: oldKey, sent: ['2026-11-27'], done: [], asked: true, deleting: true }));
    } else if (location.origin === canonical) {
      localStorage.setItem(key, JSON.stringify({ analytics: 'on', scores: 'on', key: newKey, sent: ['2026-11-28'], done: [], asked: false }));
    }
  }, { legacy: LEGACY_ORIGIN, canonical: CANONICAL_ORIGIN, key: PRIVACY_KEY, oldKey, newKey });
  await page.goto(LEGACY_ORIGIN);
  await expect(page.getByRole('button', { name: 'Move privacy settings only' })).toBeVisible();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Move privacy settings only' }).click();
  const branded = await popup;
  await expect(branded).toHaveURL(CANONICAL_ORIGIN + '/');
  expect(await branded.evaluate(key => JSON.parse(localStorage.getItem(key)!), PRIVACY_KEY)).toMatchObject({
    analytics: 'off', scores: 'off', key: newKey, sent: ['2026-11-28'], asked: true,
  });
  await expect(branded.getByRole('link', { name: 'Import Vercel saves' })).toBeVisible();
  expect(analyticsRequests).toBe(0);
  // The old code is still available for erasure; it was never sent to the new origin.
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PRIVACY_KEY)).toMatchObject({ key: oldKey, deleting: true });
  await page.goto(LEGACY_ORIGIN + '/?legacy-privacy=1');
  await expect(page.getByRole('button', { name: 'Delete legacy comparison scores' })).toBeVisible();
});


test('continue without saves still applies restrictive privacy before playing and retains the challenge', async ({ context, page, baseURL }) => {
  await serveOrigins(context, baseURL!);
  await page.clock.setFixedTime(now);
  await context.addInitScript(({ legacy, key }) => {
    if (location.origin === legacy && !localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ analytics: 'off', scores: 'off', key: null, sent: [], done: [], asked: true }));
    }
  }, { legacy: LEGACY_ORIGIN, key: PRIVACY_KEY });
  await page.goto(LEGACY_ORIGIN + '/?day=' + day + '&vs=245&utm_source=friend#test');
  await page.getByRole('button', { name: 'Continue without moving saves' }).click();
  await expect(page).toHaveURL(CANONICAL_ORIGIN + '/?day=' + day + '&vs=245&utm_source=friend#test');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PRIVACY_KEY)).toMatchObject({
    analytics: 'off', scores: 'off', asked: true,
  });
  await startDailyIfNeeded(page);
  await expect(page.locator('.challenge-note')).toContainText('245');
});


test('legacy score deletion retains the original code on failure and clears it only after confirmation', async ({ context, page, baseURL }) => {
  await serveOrigins(context, baseURL!);
  const oldKey = 'C'.repeat(22);
  let calls = 0;
  await context.route(LEGACY_ORIGIN + '/api/scores', async route => {
    const req = route.request();
    expect(req.method()).toBe('DELETE');
    expect(req.postDataJSON()).toMatchObject({ player: oldKey, days: ['2026-11-27'] });
    calls++;
    await route.fulfill({ status: calls === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(calls === 1 ? { status: 'disabled' } : { status: 'ok', removed: 1 }) });
  });
  await context.addInitScript(({ legacy, key, oldKey }) => {
    if (location.origin === legacy && !localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ analytics: 'off', scores: 'on', key: oldKey, sent: ['2026-11-27'], done: ['2026-11-27'], asked: false }));
    }
  }, { legacy: LEGACY_ORIGIN, key: PRIVACY_KEY, oldKey });
  await page.goto(LEGACY_ORIGIN + '/?legacy-privacy=1');
  const erase = page.getByRole('button', { name: 'Delete legacy comparison scores' });
  await erase.click();
  await expect(page.getByText('Deletion not confirmed. Keep this browser’s data and try again.')).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PRIVACY_KEY)).toMatchObject({ key: oldKey, scores: 'off', deleting: true });
  await page.reload();
  await erase.click();
  await expect(page.getByText('Legacy linked scores deleted.')).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PRIVACY_KEY)).toMatchObject({ key: null, scores: 'off', deleting: false, sent: [], done: [] });
  await page.getByRole('button', { name: 'Continue to statwindow.app' }).click();
  await expect(page).toHaveURL(CANONICAL_ORIGIN + '/');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PRIVACY_KEY)).toMatchObject({ analytics: 'off', scores: 'off' });
});
