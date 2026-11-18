import { expect, test, type Page, type Route } from '@playwright/test';
import { collectErrors, DAY2, lockAndSettle, NBA_FIRST, next, openAt } from './helpers';

/**
 * Phase 1: the daily comparison states, share branches and privacy controls. The score
 * API is stubbed here so each server answer can be forced; the real handler and store are
 * covered by server/*.test.ts (including a real redis-server).
 */
const DAY = NBA_FIRST.toISOString().slice(0, 10);

async function playOut(page: Page) {
  for (let i = 0; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-score')).toBeVisible();
}

type Posted = { method: string; body: Record<string, unknown> | null };
async function stubScores(page: Page, answer: (p: Posted, n: number) => { status: number; body: unknown } | 'abort') {
  const calls: Posted[] = [];
  await page.route('**/api/scores**', async (route: Route) => {
    const req = route.request();
    const p = { method: req.method(), body: req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : null };
    calls.push(p);
    const a = answer(p, calls.length);
    if (a === 'abort') return route.abort('internetdisconnected');
    return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) });
  });
  return calls;
}

const stored = (over: Record<string, unknown> = {}) => (p: Posted) => ({
  status: 200,
  body: { status: 'stored', day: DAY, season: 'beta', score: p.body?.total ?? 0, n: 12, threshold: 100, ready: false, percentile: null, asOf: `${DAY}T15:00:00Z`, ...over },
});

test('below the sample gate: an honest "not enough games" line, and nothing claimed in the share text', async ({ page, browserName }) => {
  const errors = collectErrors(page);
  const calls = await stubScores(page, stored());
  await openAt(page, NBA_FIRST);
  await playOut(page);
  await expect(page.locator('.percentile')).toContainText('Not enough completed games for today’s percentile yet (12 of 100 needed)');
  expect(calls).toHaveLength(1);
  const body = calls[0]!.body!;
  // Only what the server needs: day, the five windows, a random key. No answers, URL or score claim from a link.
  expect(Object.keys(body).sort()).toEqual(['consent', 'day', 'player', 'rounds', 'total', 'v']);
  expect(body.player).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect((body.rounds as unknown[]).length).toBe(5);
  if (browserName === 'chromium' && test.info().project.name === 'desktop') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Challenge a friend' }).click();
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    expect(shared).not.toMatch(/percentile/i);
  }
  // A refresh of the finished day does not create a second record; the server would answer "duplicate" anyway.
  expect(errors).toEqual([]);
});

test('past the gate: "Xth percentile today" with the sample size, in the share text too', async ({ page, browserName }) => {
  await stubScores(page, stored({ ready: true, n: 214, percentile: { rounded: 82, exact: 82.24 } }));
  await openAt(page, NBA_FIRST);
  await playOut(page);
  await expect(page.locator('.percentile')).toContainText('82nd percentile today');
  await expect(page.locator('.percentile')).toContainText('based on 214 eligible completed games');
  await expect(page.locator('.percentile')).not.toContainText(/beat/i);
  if (browserName === 'chromium' && test.info().project.name === 'desktop') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Challenge a friend' }).click();
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    expect(shared).toContain('82nd percentile today (214 games)');
  }
});

test('where consent is required, nothing is stored until the player says yes', async ({ page }) => {
  const calls = await stubScores(page, (p) => (p.body?.consent === 'granted' ? stored()(p) : { status: 409, body: { status: 'consent-required' } }));
  await openAt(page, NBA_FIRST);
  await playOut(page);
  await expect(page.getByRole('group', { name: 'See how today’s score compares?' })).toBeVisible();
  await page.getByRole('button', { name: 'Count my score' }).click();
  await expect(page.locator('.percentile')).toContainText('Not enough completed games');
  expect(calls.map((c) => c.body?.consent)).toEqual(['default', 'granted']);
});

test('Global Privacy Control: no request at all unless asked, and "No thanks" is remembered', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }));
  const calls = await stubScores(page, stored());
  await openAt(page, NBA_FIRST);
  await playOut(page);
  await expect(page.getByRole('button', { name: 'Count my score' })).toBeVisible();
  await page.getByRole('button', { name: 'No thanks' }).click();
  await expect(page.locator('.percentile')).toContainText('You’re not in today’s comparison');
  await page.reload();
  await expect(page.locator('.percentile')).toContainText('You’re not in today’s comparison');
  expect(calls).toHaveLength(0);
});

test('practice and past-day challenge runs are never submitted', async ({ page }) => {
  const calls = await stubScores(page, stored());
  await openAt(page, DAY2, '/?day=2026-11-15&vs=200');
  await playOut(page);
  await expect(page.locator('.results-head .context')).toContainText('Challenge');
  await expect(page.locator('.percentile')).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

test('a same-day friend link is a legitimate first play and is submitted, without the link’s score', async ({ page }) => {
  const calls = await stubScores(page, stored());
  await openAt(page, NBA_FIRST, `/?day=${DAY}&vs=321`);
  await playOut(page);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.body!.day).toBe(DAY);
  expect(JSON.stringify(calls[0]!.body)).not.toContain('321');
});

test('server down or switched off: the score still shows and the game stays playable', async ({ page, browser }) => {
  await stubScores(page, () => 'abort');
  await openAt(page, NBA_FIRST);
  await playOut(page);
  await expect(page.locator('.percentile')).toContainText('isn’t available right now');
  await expect(page.getByRole('button', { name: 'Challenge a friend' })).toBeEnabled();

  // A fresh browser, so this is a first play of the day again.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.route('**/api/scores**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"status":"disabled"}' }));
  await openAt(page2, NBA_FIRST);
  await playOut(page2);
  await expect(page2.locator('.percentile')).toHaveCount(0);
  await other.close();
});

test('native share sends the spoiler-free card image when files are supported; cancel leaves no fallback', async ({ page }) => {
  await stubScores(page, stored());
  await page.addInitScript(() => {
    const w = window as unknown as { shared: unknown[]; cancelNext: boolean };
    w.shared = [];
    w.cancelNext = false;
    Object.defineProperty(navigator, 'canShare', { value: (d: { files?: File[] }) => !!d.files, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: { text: string; files?: File[] }) => {
        if (w.cancelNext) throw new DOMException('cancelled', 'AbortError');
        w.shared.push({ text: d.text, files: (d.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })) });
      },
    });
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (q === '(pointer: coarse)' ? ({ matches: true } as MediaQueryList) : mm(q));
  });
  await openAt(page, NBA_FIRST);
  await playOut(page);
  await page.getByRole('button', { name: 'Challenge a friend' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared.length)).toBe(1);
  const [shared] = (await page.evaluate(() => (window as unknown as { shared: unknown[] }).shared)) as { text: string; files: { name: string; type: string; size: number }[] }[];
  expect(shared!.files[0]).toMatchObject({ name: `stat-window-${DAY}.png`, type: 'image/png' });
  expect(shared!.files[0]!.size).toBeGreaterThan(5000);
  expect(shared!.text).toMatch(new RegExp(`/\\?day=${DAY}&vs=\\d+$`));
  await page.evaluate(() => ((window as unknown as { cancelNext: boolean }).cancelNext = true));
  await page.getByRole('button', { name: 'Challenge a friend' }).click();
  await expect(page.getByRole('textbox', { name: 'Your result to copy' })).toHaveCount(0);
});

test('the score card can be saved as a PNG', async ({ page }) => {
  await stubScores(page, stored());
  await openAt(page, NBA_FIRST);
  await playOut(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Save score card/ }).click()]);
  expect(download.suggestedFilename()).toBe(`stat-window-${DAY}.png`);
});

test('privacy controls: switch off, delete, and the full notice is reachable', async ({ page }) => {
  const calls = await stubScores(page, (p) => (p.method === 'DELETE' ? { status: 200, body: { status: 'ok', removed: 1 } } : stored()(p)));
  await openAt(page, NBA_FIRST);
  await playOut(page);
  await page.getByRole('button', { name: 'Privacy and your data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Privacy and your data' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Today’s score in the daily comparison/ }).uncheck();
  await dialog.getByRole('button', { name: 'Delete my scores' }).click();
  await expect(dialog.getByRole('status')).toContainText('Done.');
  expect(calls.at(-1)).toMatchObject({ method: 'DELETE', body: { days: [DAY] } });
  await expect(dialog.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy.html');
  await dialog.getByRole('button', { name: 'Done' }).click();
  const res = await page.request.get('/privacy.html');
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('Delete my scores');
});
