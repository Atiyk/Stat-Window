import { expect, test, type Page } from '@playwright/test';
import { lockAndSettle, NBA_FIRST, next, openAt } from './helpers';

/**
 * Runs only against a build made with VITE_ANALYTICS=vercel (npm run test:e2e:analytics).
 * The Vercel script is stubbed, so nothing leaves the machine: the test reads the
 * calls the app queued for it (window.vaq) and checks exactly which virtual page
 * views would be sent, and that refreshes and remounts don't send them twice.
 */
test.skip(!process.env.ANALYTICS_E2E, 'needs a VITE_ANALYTICS=vercel build');
test.skip(({ isMobile }) => isMobile, 'event wiring is the same on mobile; run once');

const views = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { vaq?: unknown[][] }).vaq ?? []).filter((c) => c[0] === 'pageview').map((c) => (c[1] as { path: string }).path),
  );

test.beforeEach(async ({ page }) => {
  await page.route('**/_vercel/insights/script.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
});

test('a daily run sends each funnel event once, even across reloads', async ({ page }) => {
  await openAt(page, NBA_FIRST);
  await expect.poll(() => views(page)).toEqual(['/', '/e/visit/new', '/e/start/daily']);
  const inject = await page.evaluate(() => document.querySelector('script[src*="/_vercel/insights/script.js"]')?.getAttribute('data-disable-auto-track'));
  expect(inject).toBe('1');

  await page.getByRole('slider', { name: 'Low end of your window' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => views(page)).toContain('/e/first-touch/daily');

  // A refresh before locking: a real page view, but no second start or first touch.
  await page.reload();
  await expect(page.locator('.question')).toBeVisible();
  await page.getByRole('slider', { name: 'Low end of your window' }).focus();
  await page.keyboard.press('ArrowRight');
  await lockAndSettle(page);
  await expect.poll(() => views(page)).toEqual(['/', expect.stringMatching(/^\/e\/lock\/daily\/r1\/(hit|miss)$/)]);
  await next(page);
  for (let r = 2; r <= 5; r++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-score')).toBeVisible();
  const after = await views(page);
  expect(after.filter((p) => p.startsWith('/e/lock/daily/'))).toHaveLength(5);
  expect(after.filter((p) => p.startsWith('/e/next/daily/r'))).toEqual(['/e/next/daily/r1', '/e/next/daily/r2', '/e/next/daily/r3', '/e/next/daily/r4', '/e/next/daily/r5']);
  expect(after.filter((p) => p.startsWith('/e/complete/daily/'))).toHaveLength(1);

  // Coming back to a finished day sends only the real page view.
  await page.reload();
  await expect(page.locator('.results-score')).toBeVisible();
  await expect.poll(() => views(page)).toEqual(['/']);
});

test('challenge links count as challenges, never as the daily', async ({ page }) => {
  await openAt(page, NBA_FIRST, '/?day=2026-11-15&vs=274');
  await expect.poll(() => views(page)).toEqual(['/', '/e/visit/new', '/e/challenge-open/past/with-score', '/e/start/challenge']);
  await openAt(page, NBA_FIRST, '/?day=2099-01-01');
  await expect.poll(() => views(page)).toContain('/e/challenge-open/future');
  expect(await views(page)).not.toContain('/e/start/challenge');
});

test('the real page view never carries the challenge query string', async ({ page }) => {
  await openAt(page, NBA_FIRST, '/?day=2026-11-16&vs=120');
  const stripped = await page.evaluate(() => {
    const q = (window as unknown as { vaq?: unknown[][] }).vaq ?? [];
    const before = q.find((c) => c[0] === 'beforeSend')?.[1] as (e: { url: string }) => { url: string };
    return before({ url: location.href }).url;
  });
  expect(stripped).toBe(new URL('/', page.url()).href);
});

test('Do Not Track and Global Privacy Control send nothing and load no script', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
  let loaded = false;
  await page.route('**/_vercel/insights/script.js', (r) => {
    loaded = true;
    return r.fulfill({ status: 200, body: '' });
  });
  await openAt(page, NBA_FIRST);
  await lockAndSettle(page);
  expect(await views(page)).toEqual([]);
  expect(loaded).toBe(false);
});

test('a completed daily sends one streak event, bucketed 1, 2-6 or 7plus; practice sends none', async ({ page }) => {
  const playFive = async () => {
    for (let r = 1; r <= 5; r++) {
      await lockAndSettle(page);
      await next(page);
    }
    await expect(page.locator('.results-score')).toBeVisible();
  };
  await openAt(page, new Date('2026-11-20T15:00:00Z'));
  await playFive();
  await expect.poll(async () => (await views(page)).filter((p) => p.startsWith('/e/streak/'))).toEqual(['/e/streak/daily/1']);
  // Reloading the finished day sends no second streak event.
  await page.reload();
  await expect(page.locator('.results-score')).toBeVisible();
  await expect.poll(() => views(page)).toEqual(['/']);
  // The next day: a two-day streak.
  await openAt(page, new Date('2026-11-21T15:00:00Z'));
  await playFive();
  await expect.poll(async () => (await views(page)).filter((p) => p.startsWith('/e/streak/'))).toEqual(['/e/streak/daily/2-6']);
  // A practice run of an earlier day is not a daily.
  await page.getByRole('button', { name: 'Nov 18' }).click();
  await expect(page.locator('.round-meta')).toContainText('Practice');
  await playFive();
  expect((await views(page)).filter((p) => p.startsWith('/e/streak/'))).toEqual(['/e/streak/daily/2-6']);
});

test('opening from the calendar event counts once per day, before the start, and leaves no query string', async ({ page }) => {
  await openAt(page, NBA_FIRST, '/?from=calendar');
  await expect.poll(() => views(page)).toEqual(['/', '/e/visit/new', '/e/remind/open', '/e/start/daily']);
  expect(await page.evaluate(() => location.search)).toBe('');
  const stripped = await page.evaluate(() => {
    const q = (window as unknown as { vaq?: unknown[][] }).vaq ?? [];
    const before = q.find((c) => c[0] === 'beforeSend')?.[1] as (e: { url: string }) => { url: string };
    return before({ url: location.href }).url;
  });
  expect(stripped).toBe(new URL('/', page.url()).href);
  // Opening the event again the same day sends only the real page view.
  await openAt(page, NBA_FIRST, '/?from=calendar');
  await expect.poll(() => views(page)).toEqual(['/']);
});

test('tapping a reminder link queues /e/remind/ics or /e/remind/google', async ({ page, context }) => {
  await context.route('**/remind/*.ics', (r) => r.fulfill({ status: 204, body: '' }));
  await context.route('https://calendar.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '' }));
  await openAt(page, NBA_FIRST);
  for (let r = 1; r <= 5; r++) {
    await lockAndSettle(page);
    await next(page);
  }
  await page.getByRole('link', { name: 'Apple or Outlook calendar' }).click();
  await expect.poll(async () => (await views(page)).filter((p) => p.startsWith('/e/remind/'))).toEqual(['/e/remind/ics']);
  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Google Calendar (opens in a new tab)' }).click();
  await (await popup).close();
  await expect.poll(async () => (await views(page)).filter((p) => p.startsWith('/e/remind/'))).toEqual(['/e/remind/ics', '/e/remind/google']);
});

test('under Global Privacy Control the reminder sends nothing and loads no script', async ({ page, context }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
  let loaded = false;
  await page.route('**/_vercel/insights/script.js', (r) => {
    loaded = true;
    return r.fulfill({ status: 200, body: '' });
  });
  await context.route('**/remind/*.ics', (r) => r.fulfill({ status: 204, body: '' }));
  await context.route('https://calendar.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '' }));
  await openAt(page, NBA_FIRST, '/?from=calendar');
  for (let r = 1; r <= 5; r++) {
    await lockAndSettle(page);
    await next(page);
  }
  await page.getByRole('link', { name: 'Apple or Outlook calendar' }).click();
  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Google Calendar (opens in a new tab)' }).click();
  await (await popup).close();
  expect(await views(page)).toEqual([]);
  expect(loaded).toBe(false);
});
