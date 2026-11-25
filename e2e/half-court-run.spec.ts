import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { parseSlate, type Question } from '../src/content/schema';
import { courtPosition } from '../src/engine/court-run';
import { normalizeWindow, totalPoints, type RoundRecord } from '../src/engine/game';
import { potentialPoints as potential, scoreWindow, type Window } from '../src/engine/scoring';
import { SAVE_KEY, type SaveData } from '../src/engine/storage';
import { lockAndSettle, next, startDailyIfNeeded, typeWindow } from './helpers';

const day = '2026-11-24';
const previousDay = '2026-11-23';
const now = new Date(`${day}T15:00:00Z`);
const readSlate = (date: string) =>
  parseSlate(JSON.parse(readFileSync(new URL(`../content/days/${date}.json`, import.meta.url), 'utf8')));
const slate = readSlate(day);
const yesterday = readSlate(previousDay);
const made = (q: Question) => q.answer === q.min
  ? normalizeWindow(q, { lo: q.min, hi: q.min + q.step })
  : normalizeWindow(q, { lo: q.answer - q.step, hi: q.answer });
const missed = (q: Question) => q.answer > q.min + q.step
  ? normalizeWindow(q, { lo: q.min, hi: q.min + q.step })
  : normalizeWindow(q, { lo: q.max - q.step, hi: q.max });
const catchZero = (q: Question) => q.answer === q.min
  ? normalizeWindow(q, { lo: q.min, hi: q.max - q.step })
  : normalizeWindow(q, { lo: q.min + q.step, hi: q.max });
const record = (q: Question, window: Window): RoundRecord =>
  ({ questionId: q.id, ...window, ...scoreWindow(q, window), elapsedMs: 2000 });
const prefix = slate.questions.slice(0, 4).map((q, i) => record(q, i < 2 ? made(q) : missed(q)));
const last = slate.questions[4]!;
const complete = { results: [...prefix, record(last, made(last))], advanced: 5 };
const previousRecord = (wins: number, extra = false) => ({
  advanced: 5,
  results: yesterday.questions.map((q, i) => record(q, i < wins ? made(q) : extra && i === wins
    ? normalizeWindow(q, { lo: q.min, hi: Math.max(q.answer, q.min + (q.max - q.min) / 2) })
    : missed(q))),
});
const progress = (page: Page) => page.locator('.live-court');

async function seed(page: Page, runs: SaveData['runs'] = {}, practice?: SaveData['practice']) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/scores*', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.addInitScript(({ key, save }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(save));
  }, { key: SAVE_KEY, save: { version: 1, runs, practice, settings: { sound: false, introSeen: true } } });
}

async function expectCourt(page: Page, points: number) {
  const { x, y } = courtPosition(points);
  await expect(progress(page)).toHaveAttribute('data-total', String(points));
  await expect(progress(page).locator('[data-court-ball]')).toHaveAttribute('transform', `translate(${x} ${y})`);
}

async function submit(page: Page, { lo, hi }: Window) {
  await typeWindow(page, lo, hi);
  await lockAndSettle(page);
  await expect(page.getByRole('button', { name: /Next question|See your day/ })).toBeEnabled();
}

test('the ball follows earned points through a hit, miss, timeout, zero-point catch and restored run', async ({ page }) => {
  await seed(page);
  await page.clock.install({ time: now });
  await page.goto('/');
  await startDailyIfNeeded(page);
  await expect(page.getByRole('timer')).toHaveAttribute('aria-label', 'Shot clock: 24 seconds left');
  await expectCourt(page, 0);
  await submit(page, made(slate.questions[0]!));
  await expectCourt(page, 100);
  await expect(progress(page).locator('[data-court-marker]').evaluate((marker) => marker.getAnimations().length)).resolves.toBe(0);
  await page.reload();
  await expectCourt(page, 100);
  await next(page);
  await submit(page, missed(slate.questions[1]!));
  await expectCourt(page, 100);
  await next(page);
  await page.clock.fastForward('00:25');
  await page.clock.runFor(500);
  await expect(page.locator('.outcome-word')).toHaveText('Time’s up.');
  await expectCourt(page, 100);
  await next(page);
  await submit(page, catchZero(slate.questions[3]!));
  await expect(page.locator('.outcome-word')).toContainText('too wide to score');
  await expectCourt(page, 100);
  await next(page);
  await expect(page.locator('.round-record-target')).toHaveCount(0);
  await submit(page, made(last));
  await expectCourt(page, 200);
  await next(page);

  await expect(page.getByRole('heading', { name: 'Score 200 of 500' })).toBeVisible();
  const recap = page.getByRole('region', { name: 'Your game on the court' });
  const shotsTab = recap.getByRole('tab', { name: 'Shot chart' });
  await expect(shotsTab).toHaveAttribute('aria-selected', 'true');
  const shots = recap.getByRole('list', { name: 'Each shot' }).getByRole('listitem');
  await expect(shots).toHaveCount(5);
  await expect(shots.nth(0)).toContainText('Scored');
  await expect(shots.nth(1)).toContainText('100');
  await expect(shots.nth(1)).toContainText('Missed');
  await expect(shots.nth(2)).toContainText('Timeout');
  await expect(shots.nth(3)).toContainText('0-point catch');
  // A narrow miss is plotted as far out as a narrow make: risk, not reward.
  const far = async (n: number) => recap.locator(`[data-shot="${n}"]`).evaluate((g) => g.getAttribute('transform'));
  expect(await far(2)).not.toBe(await far(1));
  await shotsTab.focus();
  await page.keyboard.press('ArrowRight');
  const runTab = recap.getByRole('tab', { name: 'Court run' });
  await expect(runTab).toBeFocused();
  await expect(runTab).toHaveAttribute('aria-selected', 'true');
  const checkpoints = recap.getByRole('list', { name: 'Cumulative score by question' });
  await expect(checkpoints.locator('strong')).toHaveText(['100', '100', '100', '100', '200']);
  await expect(recap.locator('.performance-caption')).toHaveText('16 more points reach the three-point line.');
  const accessibility = await new AxeBuilder({ page }).include('.performance').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('the outlined ball previews the window live, freezes on lock and resolves into the earned ball', async ({ page }) => {
  await seed(page);
  await page.clock.install({ time: now });
  await page.goto('/');
  await startDailyIfNeeded(page);
  const q = slate.questions[0]!;
  const ghost = progress(page).locator('[data-court-ghost]');
  await expect(ghost).toHaveCount(0);
  const lo = page.getByRole('slider', { name: 'Low end of your window' });
  await lo.focus();
  let last = -1;
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('PageUp');
    const window = { lo: Number(await lo.getAttribute('aria-valuenow')), hi: q.max };
    const worth = potential(q, window);
    if (worth > 0) {
      await expect(progress(page)).toHaveAttribute('data-potential', String(worth));
      const { x } = courtPosition(worth);
      await expect(ghost).toHaveAttribute('transform', `translate(${x} 25)`);
      expect(worth).toBeGreaterThanOrEqual(last);
      last = worth;
    }
  }
  await expect(progress(page)).toHaveAttribute('data-total', '0');
  await lo.focus();
  await page.keyboard.press('Home');
  await submit(page, made(q));
  await expect(ghost).toHaveCount(0);
  await expectCourt(page, scoreWindow(q, made(q)).points);
});

test('the final target compares real prior scores and resolves from the fifth awarded score', async ({ page }) => {
  const best = previousRecord(2, true);
  const needed = totalPoints(best.results) + 1 - totalPoints(prefix);
  expect(needed).toBeGreaterThan(1);
  expect(needed).toBeLessThanOrEqual(100);
  await seed(page, { [day]: { results: prefix, advanced: 4 }, [previousDay]: best });
  await page.clock.setFixedTime(now);
  await page.goto('/');
  await expect(page.locator('.round-record-target')).toHaveText(`${needed} points for a new personal best.`);
  await expectCourt(page, 200);
  const flag = progress(page).locator('[data-court-record]');
  const record = courtPosition(totalPoints(best.results) + 1);
  await expect(flag).toHaveAttribute('transform', `translate(${record.x} ${record.y})`);
  await submit(page, made(last));
  await expect(page.locator('.round-record-target')).toHaveText('New personal best.');
  await next(page);
  await expect(page.locator('.results-verdict')).toHaveText(`New personal best by ${101 - needed} points.`);
});

test('a final window below the target can still lock', async ({ page }) => {
  const best = previousRecord(2, true);
  await seed(page, { [day]: { results: prefix, advanced: 4 }, [previousDay]: best });
  await page.clock.setFixedTime(now);
  await page.goto('/');
  await expect(page.locator('.round-record-target')).toContainText('for a new personal best');
  await submit(page, catchZero(last));
  await expect(page.locator('.round-record-target')).toHaveText(`Personal best remains ${totalPoints(best.results)} points.`);
});

test('the final question acknowledges a record already secured', async ({ page }) => {
  await seed(page, { [day]: { results: prefix, advanced: 4 }, [previousDay]: previousRecord(1) });
  await page.clock.setFixedTime(now);
  await page.goto('/');
  await expect(page.locator('.round-record-target')).toHaveText('You’ve already set a new personal best.');
  await submit(page, missed(last));
  await expect(page.locator('.round-record-target')).toHaveText('New personal best.');
});

test('unattainable records and practice history do not supply a target', async ({ page }) => {
  await seed(page, { [day]: { results: prefix, advanced: 4 }, [previousDay]: previousRecord(4) },
    { [previousDay]: previousRecord(2, true) });
  await page.clock.setFixedTime(now);
  await page.goto('/');
  await expect(page.locator('.round-label')).toContainText('Final window');
  await submit(page, made(last));
  await expect(page.locator('.round-record-target')).toHaveCount(0);
});

test('a same-day challenge uses the existing timed run without a new personal-best goal', async ({ page }) => {
  await seed(page, { [day]: { results: prefix, advanced: 4 }, [previousDay]: previousRecord(2, true) });
  await page.clock.setFixedTime(now);
  await page.goto(`/?day=${day}&vs=250`);
  await expect(page.locator('.round-label')).toContainText('Final window');
  await expect(page.getByRole('timer')).toHaveText('24s');
  await expect(page.locator('.round-record-target')).toHaveCount(0);
});

test('an official round settled in another tab appears at its earned position without replay', async ({ page, context }) => {
  await seed(page);
  await page.clock.setFixedTime(now);
  await page.goto('/');
  await startDailyIfNeeded(page);
  const other = await context.newPage();
  await other.clock.setFixedTime(now);
  await other.goto('/');
  await startDailyIfNeeded(other);
  await expectCourt(other, 0);
  await submit(page, made(slate.questions[0]!));
  await expectCourt(other, 100);
  await expect(other.locator('.round')).not.toHaveAttribute('data-fresh-result');
  await other.close();
});

test('finishing yesterday in another tab updates the record used by the final shot', async ({ page, context }) => {
  const older = readSlate('2026-11-22');
  const olderBest = { advanced: 5, results: older.questions.map((q, i) => record(q, i < 4 ? made(q) : missed(q))) };
  const fourHits = slate.questions.slice(0, 4).map((q) => record(q, made(q)));
  await seed(page, {
    [older.date]: olderBest,
    [previousDay]: { ...previousRecord(5), advanced: 4 },
    [day]: { results: fourHits, advanced: 4 },
  });
  await page.clock.setFixedTime(now);
  await page.goto('/');
  await expect(page.locator('.round-record-target')).toHaveText('1 point for a new personal best.');

  const other = await context.newPage();
  await other.route('**/api/scores*', (route) => route.fulfill({ status: 503, body: '{}' }));
  await other.clock.setFixedTime(new Date(`${previousDay}T23:59:00Z`));
  await other.goto('/');
  await other.getByRole('button', { name: 'See your day' }).click();
  await expect(other.getByRole('heading', { name: 'Score 500 of 500' })).toBeVisible();
  await expect(page.locator('.round-record-target')).toHaveCount(0);
  await other.close();
});

test('all six styles and formats export actual-sized PNGs for the day played', async ({ page }) => {
  await seed(page, { [day]: complete });
  await page.clock.setFixedTime(now);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Challenge a friend' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Classic' })).toBeHidden();
  await page.getByRole('button', { name: 'Customize or save score card' }).click();
  await expect(page.getByRole('radio', { name: 'Classic' })).toBeChecked();

  const hashes = new Set<string>();
  for (const [label, suffix] of [['Classic', ''], ['Shot Chart', '-shot-chart'], ['Court Run', '-court-run']]) {
    await page.getByRole('radio', { name: label!, exact: true }).check();
    for (const [format, height] of [['Square', 1080], ['Portrait', 1920]] as const) {
      await page.getByRole('radio', { name: format, exact: true }).check();
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save score card', exact: true }).click();
      const download = await event;
      const png = readFileSync((await download.path())!);
      expect(download.suggestedFilename()).toBe(`stat-window-${day}${suffix}${format === 'Portrait' ? '-portrait' : ''}.png`);
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUint32BE(16)).toBe(1080);
      expect(png.readUint32BE(20)).toBe(height);
      hashes.add(png.toString('base64'));
    }
  }
  expect(hashes.size).toBe(6);
});

test('the mobile share callback receives the selected file and the same-day challenge during the tap', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Native file sharing is shown on coarse pointer devices');
  await seed(page, { [day]: complete });
  await page.clock.setFixedTime(now);
  await page.addInitScript(() => {
    let click: MouseEvent | null = null;
    document.addEventListener('click', (event) => {
      click = event;
    }, { capture: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    Object.defineProperty(navigator, 'share', { value: (data: ShareData) => {
      document.body.dataset.shareTap = String(click !== null && click.eventPhase !== Event.NONE);
      document.body.dataset.shareFile = data.files?.[0]?.name ?? '';
      document.body.dataset.shareText = data.text ?? '';
      return Promise.resolve();
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Challenge a friend' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-share-tap', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-share-file', '');
  await page.getByRole('button', { name: 'Customize or save score card' }).click();
  await page.getByRole('radio', { name: 'Shot Chart' }).check();
  await page.getByRole('radio', { name: 'Portrait' }).check();
  const imageShare = page.getByRole('button', { name: 'Share score card' });
  await expect(imageShare).toBeEnabled();
  await imageShare.click();
  await expect(page.locator('body')).toHaveAttribute('data-share-tap', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-share-file', `stat-window-${day}-shot-chart-portrait.png`);
  await expect(page.locator('body')).toHaveAttribute('data-share-text', new RegExp(`day=${day}&vs=300`));
});

test('a failed export keeps the share action available', async ({ page }) => {
  await seed(page, { [day]: complete });
  await page.clock.setFixedTime(now);
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(null);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Customize or save score card' }).click();
  await page.getByRole('radio', { name: 'Court Run' }).check();
  await page.getByRole('button', { name: 'Save score card', exact: true }).click();
  await expect(page.getByText('Couldn’t make the image. Try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Challenge a friend' })).toBeEnabled();
});

test('the final window and completed courts fit requested phone, tablet and desktop sizes', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Viewport sweep runs in desktop Chromium');
  await seed(page, { [day]: { results: prefix, advanced: 4 }, [previousDay]: previousRecord(2, true) });
  await page.clock.setFixedTime(now);
  await page.goto('/');
  await expect(page.locator('.round-record-target')).toContainText('new personal best');
  const sizes = [[320, 568], [375, 812], [390, 844], [430, 932], [720, 450], [768, 1024], [1024, 768], [1440, 900]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect(progress(page)).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('timer')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.ruler-track')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px`).toBeLessThanOrEqual(width!);
  }
  await submit(page, made(last));
  await next(page);
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width: width!, height: height! });
    for (const court of await page.locator('.performance-court').all()) {
      const box = (await court.boundingBox())!;
      // The full half court keeps its real 47 × 50 proportions at every size.
      expect(box.width / box.height).toBeCloseTo(48.2 / 51.2, 2);
      const rect = box;
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(Math.ceil(rect!.x + rect!.width)).toBeLessThanOrEqual(width!);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px results`).toBeLessThanOrEqual(width!);
  }
});
