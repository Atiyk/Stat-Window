import { expect, test, type Locator, type Page } from '@playwright/test';
import { lockAndSettle, next, openAt, startDailyIfNeeded, typeWindow } from './helpers';

/** 2026-11-21 (No. 7 of the beta): Q1 is 25–100, answer 73. */
const NOV21 = new Date('2026-11-21T15:00:00Z');
const shots = process.env.SWEEP_SHOTS ?? 'test-results/screens/sweep';

async function playFive(page: Page, beforeLast?: () => Promise<void>) {
  for (let i = 0; i < 5; i++) {
    await lockAndSettle(page);
    if (i === 4 && beforeLast) await beforeLast();
    await next(page);
  }
}

/** True when `el` is fully on screen and nothing docked (the sticky action bar) covers it. */
async function clearOfDock(page: Page, el: Locator) {
  const box = (await el.boundingBox())!;
  const bar = (await page.locator('.action-bar').boundingBox())!;
  const vh = page.viewportSize()!.height;
  return { top: box.y, bottom: box.y + box.height, barTop: bar.y, ok: box.y >= 0 && box.y + box.height <= Math.min(vh, bar.y) + 0.5 };
}

test.describe('BUG-01: 320x568 first screen and reveal', () => {
  test('ruler, hint, verdict and points clear the docked button', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openAt(page, NOV21);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/bug01-320-first.png` });
    expect(await clearOfDock(page, page.locator('.ruler-track'))).toMatchObject({ ok: true });
    expect(await clearOfDock(page, page.locator('.verdict-line p'))).toMatchObject({ ok: true });
    await expect(page.getByRole('button', { name: 'Pull the brackets in first' })).toBeInViewport({ ratio: 1 });
    await lockAndSettle(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${shots}/bug01-320-reveal.png` });
    expect(await clearOfDock(page, page.locator('.verdict-line .outcome'))).toMatchObject({ ok: true });
    expect(await clearOfDock(page, page.locator('.ruler-track'))).toMatchObject({ ok: true });
    await expect(page.getByRole('button', { name: 'Next question' })).toBeInViewport({ ratio: 1 });
  });
});

test.describe('BUG-02: results open at the top', () => {
  test('at 320x568 the results start at scrollY 0 with the visible heading focused', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openAt(page, NOV21);
    await playFive(page, () => page.evaluate(() => window.scrollBy(0, 400)));  // scroll mid-game; mouse.wheel is unsupported in mobile WebKit
    await expect(page.locator('.results-title')).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${shots}/bug02-320-results.png` });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator('.results-title')).toBeFocused();
    await expect(page.locator('.results-title')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.results-score')).toBeInViewport({ ratio: 1 });
  });
});

test.describe('BUG-08: 200% text on the results page', () => {
  for (const width of [390, 320]) {
    test(`no sideways scroll on results at ${width} with 200% text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await openAt(page, NOV21);
      await page.addStyleTag({ content: 'html{font-size:200%}' });
      await playFive(page);
      await expect(page.locator('.results-score')).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shots}/bug08-${width}-results.png`, fullPage: true });
      const over = await page.evaluate(() => {
        const vw = window.innerWidth;
        return Array.from(document.querySelectorAll('body *')).filter((e) => e.getBoundingClientRect().right > vw + 1).map((e) => e.className).slice(0, 8);
      });
      expect(over).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
  }
});

test.describe('BUG-03: a window worth 0 is honest before and after the lock', () => {
  for (const returning of [false, true]) {
    test(`26 to 100 warns it scores 0, and the reveal says why (${returning ? 'returning' : 'first-time'} player)`, async ({ page }) => {
      await openAt(page, NOV21);
      if (returning) {
        // Finish the first-time hint the normal way, then reload as a returning player.
        await page.getByRole('slider', { name: 'Low end of your window' }).focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowLeft');
        await page.reload();
        await expect(page.locator('.question')).toBeVisible();
        await expect(page.locator('.verdict-line')).toHaveText('Pull the brackets in to start scoring.');
      }
      await typeWindow(page, 26, 100);
      const lock = page.getByRole('button', { name: 'Lock the window' });
      await expect(lock).toBeEnabled();
      await expect(page.locator('.verdict-line')).toContainText('Worth 0 even if it’s inside');
      await expect(page.locator('.verdict-line')).not.toContainText('Drag a bracket in');
      await expect(page.locator('.verdict-line')).not.toContainText('to start scoring');
      await page.screenshot({ path: `${shots}/bug03-prelock-${returning ? 'returning' : 'first'}.png` });
      await lock.click();
      await expect(page.locator('.story')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.outcome-hit')).toContainText('too wide to score');
      await expect(page.locator('.outcome-points')).toHaveText('+0');
      await page.screenshot({ path: `${shots}/bug03-reveal-${returning ? 'returning' : 'first'}.png` });
    });
  }

  test('Help explains that a nearly whole ruler also scores 0', async ({ page }) => {
    await openAt(page, NOV21);
    await page.getByRole('button', { name: 'How to play' }).click();
    await expect(page.getByRole('dialog', { name: 'How it works' })).toContainText(/nearly the whole ruler.*scores? 0/i);
  });
});

test.describe('BUG-04: the percentile slot while games are gathering', () => {
  const DAY = '2026-11-21';
  type Call = { method: string; url: string; body: Record<string, unknown> | null };
  /** A stub of /api/scores that keeps the beta and qa tallies apart, as the real server does. */
  async function stub(page: Page, tally: { beta: number; qa: number }) {
    const calls: Call[] = [];
    await page.route('**/api/scores**', async (route) => {
      const req = route.request();
      const body = req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : null;
      calls.push({ method: req.method(), url: req.url(), body });
      const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (req.method() === 'GET') return json({ status: 'ok', day: DAY, season: 'beta', n: tally.beta, threshold: 100, ready: false, asOf: `${DAY}T15:00:00Z` });
      if (body && !('player' in body)) return json({ status: 'proceed' });
      const season = body?.test === true ? 'qa' : 'beta';
      const seen = calls.filter((c) => c.method === 'POST' && c.body && 'player' in c.body).length > 1;
      return json({ status: seen ? 'duplicate' : 'stored', day: DAY, season, score: body?.total ?? 0, n: tally[season], threshold: 100, ready: false, percentile: null, asOf: `${DAY}T15:00:00Z` });
    });
    return calls;
  }

  test('under 50 games the line is hidden entirely', async ({ page }) => {
    await stub(page, { beta: 12, qa: 12 });
    await openAt(page, NOV21);
    await playFive(page);
    await expect(page.locator('.results-score')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator('.results')).not.toContainText('needed');
    await expect(page.locator('.percentile:visible')).toHaveCount(0);
  });

  test('from 50 games: "Percentiles unlock at 100 games today: N so far"', async ({ page }) => {
    await stub(page, { beta: 60, qa: 60 });
    await openAt(page, NOV21);
    await playFive(page);
    await expect(page.locator('.percentile')).toContainText('Percentiles unlock at 100 games today: 60 so far');
    await expect(page.locator('.results')).not.toContainText('needed');
    await page.screenshot({ path: `${shots}/bug04-gathering-60.png` });
  });

  test('a QA reload reads the qa tally, once', async ({ page }) => {
    const calls = await stub(page, { beta: 0, qa: 70 });
    await openAt(page, NOV21, '/?qa=1');
    await playFive(page);
    await expect(page.locator('.percentile')).toContainText('70 so far');
    calls.length = 0;
    await page.reload();
    await expect(page.locator('.results-score')).toBeVisible();
    await expect(page.locator('.percentile')).toContainText('70 so far');
    await page.waitForTimeout(800);
    expect(calls.filter((c) => c.method === 'GET')).toEqual([]);
    const keys = calls.map((c) => `${c.method} ${c.url} ${JSON.stringify(c.body)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('a normal reload reads the tally once', async ({ page }) => {
    const calls = await stub(page, { beta: 60, qa: 0 });
    await openAt(page, NOV21);
    await playFive(page);
    await expect(page.locator('.percentile')).toContainText('60 so far');
    calls.length = 0;
    await page.reload();
    await expect(page.locator('.percentile')).toContainText('60 so far');
    await page.waitForTimeout(800);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });
});

test.describe('BUG-06: practice and challenge results lead with "Challenge a friend"', () => {
  const firstAction = (page: Page) => page.locator('.results-actions .btn').first();

  async function sharedText(page: Page) {
    await page.getByRole('button', { name: 'Challenge a friend' }).click();
    return page.evaluate(() => navigator.clipboard.readText());
  }

  test('a practice run from the archive', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop', 'clipboard read is checked on desktop Chromium');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openAt(page, NOV21);
    await playFive(page);
    await page.getByRole('button', { name: 'Nov 18' }).click();
    await startDailyIfNeeded(page);
    await expect(page.locator('.round-meta')).toContainText('Practice');
    await playFive(page);
    await expect(firstAction(page)).toHaveText('Challenge a friend');
    await expect(page.getByRole('button', { name: 'Play today’s puzzle' })).toBeVisible();
    const total = await page.locator('.results-score').textContent();
    await page.screenshot({ path: `${shots}/bug06-practice-results.png` });
    expect(await sharedText(page)).toMatch(new RegExp(`/\\?day=2026-11-18&vs=${total}&time=\\d+$`));
  });

  test('a friend’s challenge link', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop', 'clipboard read is checked on desktop Chromium');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openAt(page, NOV21, '/?day=2026-11-18&vs=250');
    await playFive(page);
    await expect(page.locator('.versus')).toBeVisible();
    await expect(firstAction(page)).toHaveText('Challenge a friend');
    const total = await page.locator('.results-score').textContent();
    await page.screenshot({ path: `${shots}/bug06-challenge-results.png` });
    expect(await sharedText(page)).toMatch(new RegExp(`/\\?day=2026-11-18&vs=${total}&time=\\d+$`));
  });

  test('EU flow: after "Count my score" the answer is brought into view', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.route('**/api/scores**', (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      if (body.consent !== 'granted') return route.fulfill({ status: 409, contentType: 'application/json', body: '{"status":"consent-required"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'stored', day: '2026-11-21', season: 'beta', score: body.total, n: 64, threshold: 100, ready: false, percentile: null, asOf: '2026-11-21T15:00:00Z' }) });
    });
    await openAt(page, NOV21);
    await playFive(page);
    await page.getByRole('button', { name: 'Count my score' }).click();
    await expect(page.locator('.percentile')).toContainText('64 so far');
    await expect(page.locator('.percentile-slot')).toBeFocused();
    await expect(page.locator('.percentile-slot')).toBeInViewport();
    await page.screenshot({ path: `${shots}/bug06-320-after-yes.png` });
  });
});

test.describe('BUG-05: a bad ?day= link says so and cleans the address bar', () => {
  for (const q of ['/?day=2026-11-25&vs=250', '/?day=2099-01-01', '/?day=2026-13-45&vs=250', '/?day=garbage&vs=999', '/?day=2025-01-01&vs=100', '/?day=%E0%A4%A']) {
    test(`${q} opens today with a dismissible note`, async ({ page }) => {
      await openAt(page, NOV21, q);
      await expect(page.locator('.day-label')).toHaveText('No. 7');
      const note = page.getByRole('status').filter({ hasText: 'That link’s puzzle isn’t available, so here’s today’s.' });
      await expect(note).toBeVisible();
      await expect.poll(() => page.evaluate(() => location.search)).toBe('');
      if (q.includes('garbage')) await page.screenshot({ path: `${shots}/bug05-garbage-note.png` });
      await note.getByRole('button', { name: 'Dismiss' }).click();
      await expect(note).toHaveCount(0);
    });
  }

  test('other parameters survive the clean-up, and a good link shows no note', async ({ page }) => {
    await openAt(page, NOV21, '/?qa=1&day=garbage&vs=3');
    await expect(page.getByText('That link’s puzzle isn’t available')).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.search)).toBe('?qa=1');
    await openAt(page, NOV21, '/?day=2026-11-18&vs=250');
    await expect(page.locator('.challenge-note')).toBeVisible();
    await expect(page.getByText('That link’s puzzle isn’t available')).toHaveCount(0);
  });
});

test.describe('BUG-11: the share fallback', () => {
  test('the copy box comes into view selected, and the toast does not cover the share button', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });
    await page.setViewportSize({ width: 320, height: 568 });
    await openAt(page, NOV21);
    await playFive(page);
    const button = page.getByRole('button', { name: 'Challenge a friend' });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    const box = page.getByRole('textbox', { name: 'Your result to copy' });
    await expect(box).toBeInViewport({ ratio: 1 });
    await expect(box).toBeFocused();
    const selected = await box.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd, el.value.length]);
    expect(selected[0]).toBe(0);
    expect(selected[1]).toBe(selected[2]);
    const toast = page.locator('.toast');
    await expect(toast).toHaveText('Copy the selected text');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/bug11-320-fallback.png` });
    const t = (await toast.boundingBox())!;
    for (const el of [button, box]) {
      const b = (await el.boundingBox())!;
      const overlap = t.x < b.x + b.width && b.x < t.x + t.width && t.y < b.y + b.height && b.y < t.y + t.height;
      expect(overlap).toBe(false);
    }
  });
});

test.describe('BUG-09, BUG-10, BUG-13: layout, colour and copy nits', () => {
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  test('BUG-09: with 200% text at 320 the wordmark never prints over the puzzle number', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await openAt(page, NOV21);
    await page.addStyleTag({ content: 'html{font-size:200%}' });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${shots}/bug09-320-text200.png` });
    const word = page.locator('.wordmark');
    if (await word.isVisible()) {
      const w = (await word.boundingBox())!;
      for (const sel of ['.day-label', '.topbar-right']) expect(overlaps(w, (await page.locator(sel).boundingBox())!), sel).toBe(false);
    }
    await expect(page.getByRole('link', { name: 'Stat Window, today’s puzzle' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

  test('BUG-10: at 200% zoom on a 1440x900 laptop (720x450) the field starts on the first screen', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 450 });
    await openAt(page, NOV21);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${shots}/bug10-720x450.png` });
    expect(await clearOfDock(page, page.locator('.readout'))).toMatchObject({ ok: true });
    expect(await clearOfDock(page, page.locator('.verdict-line p'))).toMatchObject({ ok: true });
    // The window and its scale (the top 64px of the track) are on screen above the docked button.
    const track = (await page.locator('.ruler-track').boundingBox())!;
    const bar = (await page.locator('.action-bar').boundingBox())!;
    expect(track.y + 64).toBeLessThanOrEqual(bar.y);
  });

  test('BUG-13: archive chips, the 320 round header and the stats row', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await openAt(page, NOV21);
    const ledger = (await page.locator('.round-top .ledger').boundingBox())!;
    const meta = (await page.locator('.round-meta').boundingBox())!;
    // One row: the label and the total sit beside the ledger, not wrapped under it.
    expect(meta.y).toBeLessThan(ledger.y + ledger.height);
    await page.setViewportSize({ width: 390, height: 844 });
    await playFive(page);
    // The space before the dot was in the DOM but collapsed on screen: measure the rendered gap.
    const gap = await page.getByRole('button', { name: /Nov 16/ }).locator('.archive-tag').evaluate((tag) => {
      const range = document.createRange();
      range.setStart(tag.firstChild!, 0);
      range.setEnd(tag.firstChild!, 1);
      return range.getBoundingClientRect().width;
    });
    expect(gap).toBeGreaterThan(2);
    const tops = await page.locator('.stats dd').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  });

  test('BUG-13: answer pins have a dedicated warm accent across the ruler and recap', async ({ page }) => {
    await openAt(page, NOV21);
    await page.getByRole('slider', { name: 'Low end of your window' }).focus();
    await page.keyboard.press('ArrowRight');
    const ring = await page.locator('.bracket-lo .bracket-grip').evaluate((e) => getComputedStyle(e).outlineColor);
    expect(ring).not.toBe('rgb(255, 173, 122)');
    await lockAndSettle(page);
    await expect(page.locator('.marker-pin')).toHaveCSS('background-color', 'rgb(255, 173, 122)');
    await next(page);
    for (let i = 0; i < 4; i++) {
      await lockAndSettle(page);
      await next(page);
    }
    const pins = await page.locator('.recap-pin').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    expect(pins).toHaveLength(5);
    for (const c of pins) expect(c).toBe('rgb(167, 70, 36)');
  });

  test('BUG-13: source links stay outside gameplay and legal credits remain reachable', async ({ page }) => {
    await openAt(page, NOV21);
    await lockAndSettle(page);
    await expect(page.locator('.sources')).toHaveCount(0);
    await page.goto('/credits.html');
    await expect(page.getByRole('heading', { name: 'Editorial credits' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Creative Commons Attribution-ShareAlike 4.0' }))
      .toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
    expect(await page.locator('a[href*="en.wikipedia.org/wiki/"]').count()).toBeGreaterThan(100);
  });
});
