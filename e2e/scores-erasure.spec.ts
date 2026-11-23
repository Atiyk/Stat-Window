import { expect, test } from '@playwright/test';

const KEY = 'stat-window:privacy:v1';
const oldKey = 'a'.repeat(22);
const initialize = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(({ key, player }) => {
    localStorage.setItem(key, JSON.stringify({
      analytics: 'off', scores: 'on', key: player, asked: true,
      sent: ['2026-11-18'], done: ['2026-11-18'], deleting: false,
    }));
  }, { key: KEY, player: oldKey });
};

for (const [label, payload] of [
  ['server error', '{"status":"error"}'],
  ['malformed JSON', 'not valid json'],
  ['invalid removed count', '{"status":"ok","removed":null}'],
] as const) {
  test(`percentile DELETE HTTP 200 with ${label} preserves the old erasure key and stops submissions`, async ({ page }) => {
    await initialize(page);
    let deletions = 0;
    await page.route('**/api/scores', route => {
      if (route.request().method() !== 'DELETE') throw new Error('Unexpected daily score request');
      deletions++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: payload });
    });
    await page.goto('/?privacy=1');
    await page.getByRole('button', { name: 'Delete my scores' }).click();
    await expect(page.getByText('Deletion is not confirmed. New scores are blocked and your original code is saved for a retry.')).toBeVisible();
    expect(deletions).toBe(1);
    const state = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), KEY);
    expect(state).toMatchObject({
      key: oldKey, sent: ['2026-11-18'], done: ['2026-11-18'], scores: 'off', deleting: true,
    });
    // Even a second privacy choice must not silently resume enrollment.
    await expect(page.locator('.privacy-row input[type="checkbox"]').nth(1)).toBeDisabled();
  });
}

test('percentile DELETE success clears code only after explicit confirmation', async ({ page }) => {
  await initialize(page);
  let deletes = 0;
  await page.route('**/api/scores', route => {
    if (route.request().method() !== 'DELETE') throw new Error('Unexpected daily score request');
    deletes++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","removed":0}' });
  });
  await page.goto('/?privacy=1');
  await page.getByRole('button', { name: 'Delete my scores' }).click();
  await expect(page.getByText(/Done\. Scores this browser sent/)).toBeVisible();
  expect(deletes).toBe(1);
  const state = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), KEY);
  expect(state.key).toBeNull();
  expect(state).toMatchObject({ scores: 'off', deleting: false, sent: [], done: [] });
  // No new code is generated until the next consented score submission.
  // A repeated Delete is therefore local-only without an extra Redis command.
  await page.getByRole('button', { name: 'Delete my scores' }).click();
  await expect(page.getByText(/Nothing to delete/)).toBeVisible();
  expect(deletes).toBe(1);
});

test('a pending daily score deletion cannot enqueue a duplicate DELETE from double taps', async ({ page }) => {
  await initialize(page);
  let calls = 0;
  let unblock!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/scores', async route => {
    if (route.request().method() !== 'DELETE') throw new Error('Unexpected percentile request');
    calls++;
    started();
    await gate;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: '{"status":"ok","removed":1}' });
  });
  await page.goto('/?privacy=1');
  await page.getByRole('button', { name: 'Delete my scores' }).click();
  await requestStarted;
  await expect(page.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  expect(calls).toBe(1);
  unblock();
  await expect(page.getByText(/Done\. Scores this browser sent/)).toBeVisible();
  expect(calls).toBe(1);
});

test('lost sent-day history never suppresses server erasure of a valid historical code', async ({ page }) => {
  await page.addInitScript(({ key, player }) => {
    localStorage.setItem(key, JSON.stringify({
      analytics: 'off', scores: 'on', key: player, asked: true,
      sent: [], done: [], deleting: false,
    }));
  }, { key: KEY, player: oldKey });
  let calls = 0;
  await page.route('**/api/scores', route => {
    if (route.request().method() !== 'DELETE') throw new Error('Unexpected score request');
    calls++;
    return route.fulfill({
      status: calls === 1 ? 503 : 200,
      contentType: 'application/json',
      body: calls === 1 ? '{"status":"disabled"}' : '{"status":"ok","removed":0}',
    });
  });
  await page.goto('/?privacy=1');
  await page.getByRole('button', { name: 'Delete my scores' }).click();
  await expect(page.getByText(/Deletion is not confirmed/)).toBeVisible();
  expect(calls).toBe(1);
  const pending = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), KEY);
  expect(pending).toMatchObject({ key: oldKey, sent: [], scores: 'off', deleting: true });

  await page.getByRole('button', { name: 'Delete my scores' }).click();
  await expect(page.getByText(/Done\. Scores this browser sent/)).toBeVisible();
  expect(calls).toBe(2);
  const confirmed = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), KEY);
  expect(confirmed).toMatchObject({ key: null, sent: [], done: [], scores: 'off', deleting: false });
});
