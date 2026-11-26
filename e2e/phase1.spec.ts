import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
  const calls: Posted[] & { reads: string[] } = Object.assign([] as Posted[], { reads: [] as string[] });
  await page.route('**/api/scores**', async (route: Route) => {
    const req = route.request();
    // The anonymous question-comparison read (GET, no body) is not a submission; these tests count submissions.
    if (req.method() === 'GET') calls.reads.push(req.url());
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ineligible","reason":"not-today"}' });
    const p = { method: req.method(), body: req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : null };
    calls.push(p);
    // The consent probe (no browser code yet) just learns whether this location needs a yes first.
    if (p.method === 'POST' && p.body && !('player' in p.body)) {
      const a = answer(p, calls.length);
      if (a !== 'abort' && a.status === 409) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(a.body) });
      if (a === 'abort') return route.abort('internetdisconnected');
      if (a.status !== 200) return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"proceed"}' });
    }
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
  // Owner decision (2026-11-21 UI sweep, BUG-04): under 50 games no tally line is shown at all.
  await expect(page.locator('.percentile-slot')).toHaveText('Your score is in today’s tally.');
  await expect(page.locator('.percentile:visible')).toHaveCount(0);
  await expect(page.locator('.results')).not.toContainText('needed');
  // The run goes up only after the probe answers, so wait for it rather than racing it.
  await expect.poll(() => calls.length).toBe(2);
  // First a probe with nothing identifying, then only what the server needs: day, the five windows, a random key.
  expect(calls[0]!.body).toEqual({ day: DAY, consent: 'default' });
  const body = calls[1]!.body!;
  expect(Object.keys(body).sort()).toEqual(['consent', 'day', 'player', 'rounds', 'total']);
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
  // Nothing identifying went up before the yes.
  expect(calls.map((c) => c.body)).toEqual([{ day: DAY, consent: 'default' }]);
  // Both answers carry the same weight.
  const yes = await page.getByRole('button', { name: 'Count my score' }).boundingBox();
  const no = await page.getByRole('button', { name: 'No thanks' }).boundingBox();
  expect(no!.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(yes!.height - no!.height)).toBeLessThan(1);
  // The Privacy switch shows the truth: not counted until the player says so.
  await page.getByRole('button', { name: 'Privacy and your data' }).click();
  await expect(page.getByRole('checkbox', { name: /Today’s score in the daily comparison/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Count my score' }).click();
  // 12 games: under the 50-game line, so the slot only carries the screen-reader confirmation (BUG-04).
  await expect(page.locator('.percentile-slot')).toHaveText('Your score is in today’s tally.');
  await expect(page.locator('.percentile-slot')).toBeFocused();
  expect(calls.map((c) => c.body?.consent)).toEqual(['default', 'granted']);
  expect(calls[1]!.body!.player).toMatch(/^[A-Za-z0-9_-]{22}$/);
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
  // Not even the anonymous question-comparison read.
  expect(calls.reads).toHaveLength(0);
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
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]!.body!.day).toBe(DAY);
  expect(JSON.stringify(calls)).not.toContain('321');
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

test('blocked browser storage never uploads a score that the player cannot erase later', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true,
      get() { throw new DOMException('Storage blocked', 'SecurityError'); },
    });
  });
  const calls = await stubScores(page, stored());
  await openAt(page, NBA_FIRST);
  await playOut(page);
  await expect(page.locator('.percentile')).toContainText('isn’t available right now');
  // The anonymous consent probe is allowed; no browser code, five windows or
  // identifying score submission may be sent without durable erasure state.
  expect(calls.map(c => c.body)).toEqual([{ day: DAY, consent: 'default' }]);
  await expect(page.getByRole('button', { name: 'Challenge a friend' })).toBeEnabled();
});

type NativeShareProbe = {
  shared: Array<{ text: string; files: Array<{ name: string; type: string; size: number }> }>;
  cancelNext: boolean;
  cardsQueued: number;
  prepareCard: () => void;
};

test('native challenge shares straight away and the selected score card shares separately', async ({ page }) => {
  await stubScores(page, stored());
  await page.addInitScript(() => {
    const w = window as unknown as NativeShareProbe;
    w.shared = [];
    w.cancelNext = false;
    w.cardsQueued = 0;
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      w.prepareCard = () => toBlob.call(this, callback, type, quality);
      w.cardsQueued++;
    };
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
  const share = page.getByRole('button', { name: 'Challenge a friend' });
  const attempts = () => page.evaluate(() => (window as unknown as NativeShareProbe).shared);
  const cardsQueued = () => page.evaluate(() => (window as unknown as NativeShareProbe).cardsQueued);
  await expect(page.getByRole('radio', { name: 'Square' })).toHaveCount(0);
  await share.click();
  await expect.poll(attempts).toHaveLength(1);
  const [early] = await attempts();
  expect(early!.text).toMatch(new RegExp(`/\\?day=${DAY}&vs=\\d+&time=\\d+$`));
  expect(early!.files).toEqual([]);
  expect(await cardsQueued()).toBe(0);

  await page.getByRole('button', { name: 'Customize or save score card' }).click();
  const shareCard = page.getByRole('button', { name: 'Share score card' });
  await expect.poll(cardsQueued).toBe(1);
  await expect(shareCard).toBeDisabled();
  await page.evaluate(() => (window as unknown as NativeShareProbe).prepareCard());
  await expect(shareCard).toBeEnabled();
  await page.getByRole('radio', { name: 'Portrait' }).check();
  await expect.poll(cardsQueued).toBe(2);
  await expect(shareCard).toBeDisabled();
  await shareCard.dispatchEvent('click');
  expect(await attempts()).toHaveLength(1);
  await page.evaluate(() => (window as unknown as NativeShareProbe).prepareCard());
  await shareCard.click();
  await expect.poll(attempts).toHaveLength(2);
  const [, shared] = await attempts();
  expect(shared!.files[0]).toMatchObject({ name: `stat-window-${DAY}-portrait.png`, type: 'image/png' });
  expect(shared!.files[0]!.size).toBeGreaterThan(5000);
  expect(shared!.text).toBe(early!.text);
  await page.evaluate(() => ((window as unknown as NativeShareProbe).cancelNext = true));
  await shareCard.click();
  await expect(page.getByRole('textbox', { name: 'Your result to copy' })).toHaveCount(0);
  await expect(shareCard).toBeEnabled();
});

test('square and portrait score card PNGs export at their exact dimensions', async ({ page }) => {
  await stubScores(page, stored());
  await openAt(page, NBA_FIRST);
  await playOut(page);
  const disclosure = page.getByRole('button', { name: 'Customize or save score card' });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

  for (const { format, suffix, height } of [
    { format: 'Square', suffix: '', height: 1080 },
    { format: 'Portrait', suffix: '-portrait', height: 1920 },
  ]) {
    await page.getByRole('radio', { name: format }).check();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Save score card/ }).click()]);
    expect(download.suggestedFilename()).toBe(`stat-window-${DAY}${suffix}.png`);
    const png = await readFile(await download.path());
    expect(png.toString('hex', 0, 8)).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(height);
    await expect(page.locator('.results .toast')).toHaveText('Download started');
  }
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
