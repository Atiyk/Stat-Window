import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { addDays, puzzleStartUtcMs } from '../src/engine/daily';
import { collectErrors, lockAndSettle, NBA_DAYS, NBA_FIRST, NBA_MIDDLE, next, openAt, startDailyIfNeeded } from './helpers';

/** The daily calendar reminder on the results screen (src/engine/remind.ts). */

async function playFive(page: Page) {
  for (let r = 1; r <= 5; r++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-score')).toBeVisible();
}

const icsLink = (page: Page) => page.getByRole('link', { name: 'Apple or Outlook calendar' });
const googleLink = (page: Page) => page.getByRole('link', { name: 'Google Calendar (opens in a new tab)' });

/** Keeps every tap on the page: the .ics answers 204 and Google never gets a real request. */
async function stubCalendars(context: BrowserContext) {
  await context.route('**/remind/*.ics', (r) => r.fulfill({ status: 204, body: '' }));
  await context.route('https://calendar.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>stub</p>' }));
}

const storageDump = (page: Page) =>
  page.evaluate(() => ({
    local: Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])),
    session: Object.keys(sessionStorage).sort(),
    cookie: document.cookie,
  }));

test.describe('New York', () => {
  test.use({ timezoneId: 'America/New_York', locale: 'en-US' });

  test('the row offers the same New York hour tomorrow, shown in local time with minutes', async ({ page }) => {
    await openAt(page, NBA_FIRST); // 15:00Z = 10:00 AM EST
    await playFive(page);
    const row = page.locator('.remind');
    await expect(row).toContainText('Get a daily nudge at 10:00 AM:');
    await expect(row).toContainText('The time moves with daylight saving, like the puzzle.');
    await expect(row).not.toContainText('US Eastern');
    await expect(row).toContainText('We only count taps here and opens from the event.');
    await expect(icsLink(page)).toHaveAttribute('href', '/remind/10.ics');
    expect(await icsLink(page).getAttribute('download')).toBeNull();
    const g = googleLink(page);
    await expect(g).toHaveAttribute('target', '_blank');
    expect(await g.getAttribute('rel')).toContain('noreferrer');
    const u = new URL((await g.getAttribute('href'))!);
    expect(u.host).toBe('calendar.google.com');
    expect(u.searchParams.get('ctz')).toBe('America/New_York');
    const tomorrow = addDays(NBA_DAYS[0]!, 1).replace(/-/g, '');
    expect(u.searchParams.get('dates')).toBe(`${tomorrow}T100000/${tomorrow}T100500`);
    // Directly under the countdown.
    const after = await page.locator('.next-window + .remind').count();
    expect(after).toBe(1);
  });

  test('finishing at 11:30 PM Eastern offers 12:00 AM, when the next puzzle opens, and the 00 file', async ({ page }) => {
    await openAt(page, new Date(puzzleStartUtcMs(addDays(NBA_DAYS[0]!, 1)) - 30 * 60_000));
    await playFive(page);
    await expect(page.locator('.remind')).toContainText('Get a daily nudge at 12:00 AM:');
    await expect(icsLink(page)).toHaveAttribute('href', '/remind/00.ics');
    const u = new URL((await googleLink(page).getAttribute('href'))!);
    const tomorrow = addDays(NBA_DAYS[0]!, 1).replace(/-/g, '');
    expect(u.searchParams.get('dates')).toBe(`${tomorrow}T000000/${tomorrow}T000500`);
  });

  test('tapping either link shows the toast and writes nothing to storage or cookies', async ({ page, context }) => {
    await stubCalendars(context);
    await openAt(page, NBA_FIRST);
    await playFive(page);
    // Percentile submission is independently asynchronous: on slower iPhone
    // WebKit it may finish after the results are visible. Settle that outcome
    // BEFORE taking the baseline so a legitimate percentile receipt does not
    // masquerade as a calendar link mutating browser storage.
    await expect.poll(async () => page.evaluate((day) => {
      try {
        const seen = JSON.parse(localStorage.getItem('stat-window:sent') ?? '{}') as Record<string, string>;
        return Object.keys(seen).some((key) => key.startsWith(`pct:${day}:`));
      } catch { return false; }
    }, NBA_DAYS[0]!), { timeout: 10_000 }).toBe(true);
    const before = await storageDump(page);
    await icsLink(page).click();
    await expect(page.locator('.toast')).toHaveText('Reminder file ready. If it downloaded, open it to add the event.');
    const popup = context.waitForEvent('page');
    await googleLink(page).click();
    await (await popup).close();
    await expect(page.locator('.toast')).toHaveText('Reminder file ready. If it downloaded, open it to add the event.');
    // The row stays: the app can't know whether the event was saved and doesn't store that it was tried.
    await expect(icsLink(page)).toBeVisible();
    expect(await storageDump(page)).toEqual(before);
  });

  test('a second tap restarts the toast instead of letting the first one expire it', async ({ page, context }) => {
    await stubCalendars(context);
    await openAt(page, NBA_FIRST);
    await playFive(page);
    await icsLink(page).click();
    await page.waitForTimeout(1800);
    await icsLink(page).click();
    await page.waitForTimeout(1200); // 3.0 s after the first tap: past its 2.4 s timer, inside the second's
    await expect(page.locator('.toast')).toHaveAttribute('data-visible', 'true');
  });

  test('the row also appears after a practice run and a challenge run, with no console errors', async ({ page }) => {
    const errors = collectErrors(page);
    await openAt(page, NBA_MIDDLE);
    await playFive(page);
    await page.locator('.archive-list button').first().click();
    // V3 deliberately gates every fresh five-question run, including practice.
    await expect(page.locator('.question')).toHaveCount(0);
    await expect(page.getByRole('button', { name: "Start today's five" })).toBeVisible();
    await startDailyIfNeeded(page);
    await expect(page.locator('.round-meta')).toContainText('Practice');
    await playFive(page);
    await expect(page.locator('.results-context')).toContainText('Practice');
    await expect(icsLink(page)).toBeVisible();
    await expect(googleLink(page)).toBeVisible();

    await openAt(page, NBA_MIDDLE, `/?day=${NBA_DAYS[3]}&vs=200`);
    await playFive(page);
    await expect(page.locator('.results-context')).toContainText('Challenge');
    await expect(icsLink(page)).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('UTC', () => {
  test.use({ timezoneId: 'UTC', locale: 'en-US' });

  test('finishing at 15:00Z (10 AM Eastern) offers 3:00 PM and says it follows US Eastern time', async ({ page }) => {
    await openAt(page, NBA_FIRST);
    await playFive(page);
    const row = page.locator('.remind');
    await expect(row).toContainText('Get a daily nudge at 3:00 PM:');
    await expect(row).toContainText('It follows US Eastern time, like the puzzle, so here it can move by an hour when US clocks change.');
    await expect(row).not.toContainText('moves with daylight saving');
    await expect(icsLink(page)).toHaveAttribute('href', '/remind/10.ics');
  });
});

test.describe('Kolkata (+5:30)', () => {
  test.use({ timezoneId: 'Asia/Kolkata', locale: 'en-US' });

  test('finishing at 05:10 IST (6:40 PM Eastern) offers 4:30 AM, the 18 file, and the plain Eastern note', async ({ page }) => {
    // 23:40Z on the first day: still the first puzzle day in New York.
    await openAt(page, new Date(`${NBA_DAYS[0]}T23:40:00Z`));
    await playFive(page);
    const row = page.locator('.remind');
    await expect(row).toContainText('Get a daily nudge at 4:30 AM:');
    await expect(row).toContainText('It follows US Eastern time, like the puzzle');
    await expect(icsLink(page)).toHaveAttribute('href', '/remind/18.ics');
  });
});

test('the .ics files are served as calendars', async ({ request }) => {
  const res = await request.get('/remind/10.ics');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');
  const body = await res.text();
  expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(body).toContain('\r\nBEGIN:VTIMEZONE\r\nTZID:America/New_York\r\n');
  expect(body).toContain('\r\nDTSTART;TZID=America/New_York:20261115T100000\r\n');
  // 23 (New York) is never offered (it would be the hour before the reset), so no file exists for it.
  const none = await request.get('/remind/23.ics');
  expect(none.status() === 200 && (none.headers()['content-type'] ?? '').includes('text/calendar')).toBe(false);
});

test('opening from the calendar removes only from=, keeps the rest and loads today', async ({ page }) => {
  await openAt(page, NBA_FIRST, '/?from=calendar&qa=1');
  await expect(page.locator('.question')).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.search)).toBe('?qa=1');
  await expect(page.locator('.round-meta')).not.toContainText('Practice');
});

test('opening from the calendar adds only the once-a-day remind-open entry to storage, and no cookie', async ({ page }) => {
  await openAt(page, NBA_FIRST);
  // A plain reload first, so the baseline holds everything an ordinary open writes.
  await openAt(page, NBA_FIRST);
  const before = await storageDump(page);
  await openAt(page, NBA_FIRST, '/?from=calendar');
  await expect.poll(() => page.evaluate(() => location.search)).toBe('');
  const after = await storageDump(page);
  const sent = (d: typeof before) => JSON.parse(d.local['stat-window:sent'] ?? '{}') as Record<string, string>;
  expect(sent(after)).toEqual({ ...sent(before), [`remind-open:${NBA_DAYS[0]}`]: NBA_DAYS[0] });
  const strip = (d: typeof before) => ({ ...d, local: { ...d.local, 'stat-window:sent': undefined } });
  expect(strip(after)).toEqual(strip(before));
  expect(after.cookie).toBe('');
});

test('layout: wraps at 320px, 44px targets, and Tab reaches both links after the share actions', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openAt(page, NBA_FIRST);
  await playFive(page);
  await icsLink(page).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  for (const l of [icsLink(page), googleLink(page)]) {
    const box = await l.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  await page.getByRole('button', { name: 'Challenge a friend' }).focus();
  const order: string[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim()));
  }
  const customize = order.indexOf('Customize or save score card');
  const ics = order.indexOf('Apple or Outlook calendar');
  const google = order.indexOf('Google Calendar (opens in a new tab)');
  expect(customize).toBeGreaterThanOrEqual(0);
  expect(ics).toBeGreaterThan(customize);
  expect(google).toBe(ics + 1);
});
