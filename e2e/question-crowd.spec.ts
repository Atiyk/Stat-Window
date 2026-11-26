import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { collectErrors, lockAndSettle, NBA_FIRST, next, openAt } from './helpers';

/**
 * V5.1 Feature G: the one-line question comparison after each reveal, read from the same
 * GET as the percentile (stubbed here; the handler, store and Lua are covered in server/).
 */
const DAY = NBA_FIRST.toISOString().slice(0, 10);
const ids = (JSON.parse(readFileSync(new URL(`../content/days/${DAY}.json`, import.meta.url), 'utf8')) as { questions: { id: string }[] }).questions.map((q) => q.id);
const N = 250;

function questions(scored: number[]) {
  return ids.map((id, i) => ({ id, n: N, ready: true, pct: Array.from({ length: 101 }, (_, p) => (p === 0 ? 20 : 60)), scored: scored[i] }));
}

async function stub(page: Page, get: () => { status: number; body: unknown } | 'abort') {
  const reads: string[] = [];
  await page.route('**/api/scores**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      reads.push(req.url());
      const a = get();
      if (a === 'abort') return route.abort('internetdisconnected');
      return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) });
    }
    const body = req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : {};
    if (!('player' in body)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"proceed"}' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'stored', day: DAY, season: 'beta', score: body.total ?? 0, n: N, threshold: 100, ready: true, percentile: 50, asOf: `${DAY}T15:00:00Z` }),
    });
  });
  return reads;
}

const okBody = (scored: number[]) => ({
  status: 'ok', day: DAY, season: 'beta', n: N, threshold: 100, ready: true, counts: { 250: N }, questions: questions(scored), asOf: `${DAY}T15:00:00Z`,
});
const line = /^(60th percentile for this question, among 250 eligible completed games\.|\d+% of 250 eligible completed games scored on this question\.)$/;

test('after each reveal, one truthful line; never before the lock; one read for the whole run', async ({ page }) => {
  const errors = collectErrors(page);
  const reads = await stub(page, () => ({ status: 200, body: okBody([71, 52, 21, 64, 40]) }));
  await page.addInitScript(() => {
    const w = window as unknown as { shared: string[] };
    w.shared = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: { text: string }) => void w.shared.push(d.text) });
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (q === '(pointer: coarse)' ? ({ matches: true } as MediaQueryList) : mm(q));
  });
  const first = page.waitForRequest((r) => r.method() === 'GET' && r.url().includes('/api/scores?day='));
  await openAt(page, NBA_FIRST);
  await first;
  for (let i = 0; i < 5; i++) {
    // Before the window is locked there is no crowd data on screen.
    await expect(page.locator('.story-crowd')).toHaveCount(0);
    await lockAndSettle(page);
    await expect(page.locator('.story-crowd')).toHaveText(line);
    if (process.env.SHOTS && i < 2) await page.screenshot({ path: `${process.env.SHOTS}/reveal-q${i + 1}-${page.viewportSize()!.width}.png`, fullPage: true });
    await next(page);
  }
  await expect(page.locator('.results-score')).toBeVisible();
  await expect(page.locator('.crowd-toughest')).toHaveText(`Toughest for the crowd today: Question 3, scored in 21% of ${N} eligible completed games.`);
  // Share card text stays free of question statistics.
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/results-${page.viewportSize()!.width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Challenge a friend' }).click();
  const shared = () => page.evaluate(() => (window as unknown as { shared: string[] }).shared);
  await expect.poll(async () => (await shared()).length).toBe(1);
  expect((await shared())[0]).not.toMatch(/for this question|Toughest|eligible completed/);
  // The round reveals and the results refresh share the one cached read (the refresh may make at most one more).
  expect(reads.length).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

for (const [name, get] of [
  ['below the per-question gate', () => ({ status: 200, body: { ...okBody([50, 50, 50, 50, 50]), questions: ids.map((id) => ({ id, n: 40, ready: false })) } })],
  ['paused', () => ({ status: 503, body: { status: 'paused' } })],
  ['malformed', () => ({ status: 200, body: { ...okBody([50, 50, 50, 50, 50]), questions: ids.map((id) => ({ id, n: N, ready: true, pct: [1, 2] })) } })],
  ['offline', () => 'abort' as const],
] as const) {
  test(`${name}: no line, no placeholder, and the game plays the same`, async ({ page }) => {
    await stub(page, get as () => { status: number; body: unknown } | 'abort');
    await openAt(page, NBA_FIRST);
    for (let i = 0; i < 5; i++) {
      await lockAndSettle(page);
      await expect(page.getByRole('button', { name: /Next question|See your day/ })).toBeEnabled();
      await expect(page.locator('.story-crowd')).toHaveCount(0);
      await next(page);
    }
    await expect(page.locator('.results-score')).toBeVisible();
    await expect(page.locator('.crowd-toughest')).toHaveCount(0);
  });
}
