import { readdirSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, lockAndSettle, NBA_FIRST, next, openAt, typeWindow } from './helpers';

/**
 * Survival, behind its flag.
 *   npx playwright test             → flag off: Survival must be invisible and absent.
 *   npm run test:e2e:survival       → VITE_SURVIVAL=preview (4175) and =on (4176) builds.
 */
const SURVIVAL = !!process.env.SURVIVAL_E2E;
const ON = 'http://localhost:4176';
const PREVIEW_KEY = 'stat-window:survival-preview:v1';
const KEY = 'stat-window:survival:v1';

type Q = { id: string; answer: number; min: number; max: number; step: number };
const byId = new Map<string, Q>();
const dayDir = new URL('../content/days/', import.meta.url);
for (const f of readdirSync(dayDir)) {
  for (const q of (JSON.parse(readFileSync(new URL(f, dayDir), 'utf8')) as { questions: Q[] }).questions) byId.set(q.id, q);
}
for (const q of (JSON.parse(readFileSync(new URL('../content/survival/catalog.json', import.meta.url), 'utf8')) as { reserves: Q[] }).reserves) byId.set(q.id, q);

const at = (day: string, time = '15:00:00') => new Date(`${day}T${time}Z`);
type Save = { current: { id: string; questionIds: string[]; results: { questionId: string; points: number }[]; advanced: number } | null; best: Record<string, { rounds: number; points: number }>; recent: string[][] };
const save = (page: Page, key = PREVIEW_KEY) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null') as Save | null, key);

async function currentQuestion(page: Page, key = PREVIEW_KEY): Promise<Q> {
  const s = (await save(page, key))!;
  const run = s.current!;
  const round = run.results.length > run.advanced ? run.results.length - 1 : run.results.length;
  return byId.get(run.questionIds[round]!)!;
}

const fmt = (v: number, step: number) => v.toFixed(String(step).includes('.') ? String(step).split('.')[1]!.length : 0);

/** The one-step grid cell that holds the answer (answers need not sit on the grid: 899 on a 5-step scale). */
function hitWindow(q: Q): [number, number] {
  let lo = q.min + Math.floor((q.answer - q.min) / q.step + 1e-9) * q.step;
  if (lo + q.step > q.max) lo -= q.step;
  return [lo, lo + q.step];
}

/** A one-step window on the answer (100 points), or one well away from it (a miss). */
async function play(page: Page, hit: boolean, key = PREVIEW_KEY) {
  const q = await currentQuestion(page, key);
  let lo: number;
  let hi: number;
  if (hit) {
    [lo, hi] = hitWindow(q);
  } else {
    const far = q.answer - q.min > q.max - q.answer ? q.min : q.max - q.step;
    lo = far;
    hi = far + q.step;
  }
  await typeWindow(page, Number(fmt(lo, q.step)), Number(fmt(hi, q.step)));
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await expect(page.locator('.story')).toBeVisible({ timeout: 5000 });
}

async function startRun(page: Page, path = '/?survival&asof=2026-12-20', when = NBA_FIRST) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(when);
  await page.goto(path);
  await page.getByRole('button', { name: 'Start a run' }).click();
  await expect(page.getByText(/Survival · Round 1 of 20/)).toBeVisible();
}

test.describe('flag off (the production build)', () => {
  test.skip(SURVIVAL, 'runs against the normal build');

  test('?survival opens the Daily Five, and no Survival code or button exists', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await openAt(page, at('2026-12-20'), '/?survival&asof=2027-01-10');
    await expect(page.getByText('Question 1 of 5')).toBeVisible();
    await expect(page.getByText(/Survival/)).toHaveCount(0);
    expect(urls.some((u) => /Survival|catalog/.test(u))).toBe(false);
    for (let r = 0; r < 5; r++) {
      await lockAndSettle(page);
      await next(page);
    }
    await expect(page.locator('.results-score')).toBeVisible();
    await expect(page.getByRole('button', { name: /Try Survival/ })).toHaveCount(0);
  });
});

test.describe('preview build', () => {
  test.skip(!SURVIVAL, 'needs npm run test:e2e:survival');

  test('fails closed on the real cutover date: not enough finished days', async ({ page }) => {
    await page.clock.setFixedTime(NBA_FIRST);
    await page.goto('/?survival');
    await expect(page.getByRole('heading', { name: 'Survival', exact: true })).toBeVisible();
    await expect(page.getByText(/Not open yet/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start a run' })).toHaveCount(0);
  });

  test('a full run: twenty survived rounds is a win and a personal best', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'one full run is enough; mobile covers loss and layout');
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await startRun(page);
    await expect(page.getByText('Preview build')).toBeVisible();
    const first = (await save(page))!.current!.questionIds;
    expect(new Set(first).size).toBe(20);
    for (let r = 1; r <= 20; r++) {
      await expect(page.getByText(`Survival · Round ${r} of 20`)).toBeVisible();
      await play(page, true);
      await expect(page.getByText('Survived.')).toBeVisible();
      await page.getByRole('button', { name: r === 20 ? 'See your run' : 'Next round' }).click();
    }
    await expect(page.getByRole('heading', { name: 'All twenty. You survived.' })).toBeVisible();
    await expect(page.getByText('A new personal best.')).toBeVisible();
    expect((await save(page))!.best.sv1).toEqual(expect.objectContaining({ rounds: 20, points: 2000 }));
    // Never touched the Daily Five save.
    expect(await page.evaluate(() => localStorage.getItem('stat-window:v1'))).not.toContain('"runs":{"20');
    expect(errors).toEqual([]);
  });

  test('a miss ends the run; one tap starts a different one', async ({ page }) => {
    await startRun(page);
    const before = (await save(page))!.current!.questionIds;
    await play(page, false);
    await expect(page.getByText('Outside. Run over.')).toBeVisible();
    await page.getByRole('button', { name: 'See your run' }).click();
    await expect(page.getByRole('heading', { name: 'Out in round one.' })).toBeVisible();
    await expect(page.getByText(/the answer was outside your window/)).toBeVisible();
    await page.getByRole('button', { name: 'Run it again' }).click();
    await expect(page.getByText('Survival · Round 1 of 20')).toBeVisible();
    const after = (await save(page))!;
    expect(after.current!.questionIds[0]).not.toBe(before[0]);
    expect(after.recent[0]).toEqual(before);
  });

  test('the lock refuses a window worth less than the minimum', async ({ page }) => {
    await startRun(page);
    const q = await currentQuestion(page);
    // Nearly the full scale: inside, but worth almost nothing.
    await typeWindow(page, q.min + q.step, q.max);
    await expect(page.getByRole('button', { name: /Tighten to 20\+ to lock/ })).toBeDisabled();
    await expect(page.locator('.worth')).toContainText('You need 20');
  });

  test('refresh: same questions, a locked round stays locked, no extra life', async ({ page }) => {
    await startRun(page);
    const ids = (await save(page))!.current!.questionIds;
    await page.reload();
    await expect(page.getByText('Survival · Round 1 of 20')).toBeVisible();
    await play(page, true);
    await page.getByRole('button', { name: 'Next round' }).click();
    await play(page, false);
    await page.reload();
    // Back on round 2's reveal, still a loss, nothing to lock.
    await expect(page.getByText('Outside. Run over.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lock the window' })).toHaveCount(0);
    const s = (await save(page))!;
    expect(s.current!.questionIds).toEqual(ids);
    expect(s.current!.results).toHaveLength(2);
  });

  test('a second tab adopts the run the first tab moved on', async ({ page, context }) => {
    await startRun(page);
    const other = await context.newPage();
    await other.emulateMedia({ reducedMotion: 'reduce' });
    await other.clock.setFixedTime(NBA_FIRST);
    await other.goto('/?survival&asof=2026-12-20');
    await expect(other.getByText('Survival · Round 1 of 20')).toBeVisible();
    await play(page, true);
    await page.getByRole('button', { name: 'Next round' }).click();
    await expect(other.getByText('Survival · Round 2 of 20')).toBeVisible();
  });

  test('a corrupt save is set aside and the page still works', async ({ page }) => {
    await page.clock.setFixedTime(NBA_FIRST);
    await page.addInitScript((k) => localStorage.setItem(k, '{"version":1,"current":{"id":"!!"}}'), PREVIEW_KEY);
    await page.goto('/?survival&asof=2026-12-20');
    await expect(page.getByRole('button', { name: 'Start a run' })).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(`${k}:corrupt`), PREVIEW_KEY)).toContain('!!');
  });

  test('blocked storage: still playable, and the page says progress is not saved', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('denied'); } });
    });
    await startRun(page);
    await expect(page.getByText(/isn’t saving progress/)).toBeVisible();
    // No save to read the answer from: any window at or above the minimum locks and is scored.
    await page.getByRole('slider', { name: 'Low end of your window' }).focus();
    for (let i = 0; i < 60 && !(await page.getByRole('button', { name: 'Lock the window' }).isVisible()); i++) await page.keyboard.press('PageUp');
    await page.getByRole('button', { name: 'Lock the window' }).click();
    await expect(page.locator('.story')).toBeVisible();
  });

  test('switching to the Daily Five and back keeps both', async ({ page }) => {
    await startRun(page);
    await play(page, true);
    await page.getByRole('button', { name: 'Next round' }).click();
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip tutorial and start' }).click();
    await expect(page.getByText('Question 1 of 5')).toBeVisible();
    await page.goto('/?survival&asof=2026-12-20');
    await expect(page.getByText('Survival · Round 2 of 20')).toBeVisible();
  });

  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    test(`layout at ${width}px: no sideways scroll, controls reachable, no axe violations`, async ({ page }, info) => {
      test.skip(info.project.name === 'mobile' && width > 400, 'desktop project covers wide widths');
      await page.setViewportSize({ width, height: width < 700 ? 740 : 900 });
      await startRun(page);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await expect(page.locator('.survival-track')).toBeVisible();
      await expect(page.getByRole('button', { name: /Pull the brackets in first|Lock the window|Tighten/ })).toBeInViewport();
      const a11y = await new AxeBuilder({ page }).include('main').analyze();
      expect(a11y.violations.map((v) => v.id)).toEqual([]);
      await play(page, false);
      await page.getByRole('button', { name: 'See your run' }).click();
      expect(await overflow()).toBeLessThanOrEqual(0);
      const end = await new AxeBuilder({ page }).include('main').analyze();
      expect(end.violations.map((v) => v.id)).toEqual([]);
    });
  }

  test('keyboard only: a round can be adjusted, locked and moved on without a pointer', async ({ page }) => {
    await startRun(page);
    const q = await currentQuestion(page);
    // Readout buttons are focusable; type the window with the keyboard alone.
    await page.getByRole('button', { name: /^High end/ }).focus();
    await page.keyboard.press('Enter');
    const [lo, hi] = hitWindow(q);
    await page.keyboard.type(fmt(hi, q.step));
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Low end/ }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.type(fmt(lo, q.step));
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Lock the window' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Survived.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next round' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Survival · Round 2 of 20')).toBeVisible();
  });
});

test.describe('public flag (on): the offer, the gate, the events', () => {
  test.skip(!SURVIVAL, 'needs npm run test:e2e:survival');
  test.skip(({ isMobile }) => isMobile, 'event wiring is the same on mobile; run once');
  test.use({ baseURL: ON });

  const views = (page: Page) =>
    page.evaluate(() => ((window as unknown as { vaq?: unknown[][] }).vaq ?? []).filter((c) => c[0] === 'pageview').map((c) => (c[1] as { path: string }).path));

  const ARM_KEY = 'stat-window:x:survival-cta:v1';
  const setArm = (page: Page, arm: 'cta' | 'control') =>
    page.addInitScript(([k, a]) => {
      if (!localStorage.getItem(k!)) localStorage.setItem(k!, JSON.stringify({ arm: a }));
    }, [ARM_KEY, arm]);
  const finishDaily = async (page: Page) => {
    for (let r = 0; r < 5; r++) {
      await lockAndSettle(page);
      await next(page);
    }
    await expect(page.locator('.results-score')).toBeVisible();
  };

  test.beforeEach(async ({ page }) => {
    await page.route('**/_vercel/insights/script.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('experiment: control sees no button; exposure today, then daily-start and next-day-start tomorrow', async ({ page }) => {
    await setArm(page, 'control');
    await openAt(page, at('2026-12-20'));
    await finishDaily(page);
    await expect(page.getByRole('button', { name: /Try Survival/ })).toHaveCount(0);
    await expect.poll(() => views(page)).toContain('/e/x/survival-cta/control/exposed');
    expect(await views(page)).toContain('/e/x/survival-cta/control/first-exposure');
    // Next UTC day, same browser.
    await page.clock.setFixedTime(at('2026-12-21'));
    await page.reload();
    // Merely seeing the ready card must not count as starting the new day.
    await expect(page.getByRole('heading', { name: 'Ready for five?' })).toBeVisible();
    expect(await views(page)).not.toContain('/e/start/daily');
    await page.getByRole('button', { name: "Start today's five" }).click();
    await expect(page.locator('.question')).toBeVisible();
    await expect.poll(() => views(page)).toEqual(expect.arrayContaining(['/e/start/daily', '/e/x/survival-cta/control/daily-start', '/e/x/survival-cta/control/next-day-start']));
    // A refresh doesn't count the start again.
    await page.reload();
    await expect(page.locator('.question')).toBeVisible();
    await page.waitForTimeout(500);
    expect((await views(page)).filter((p) => p.startsWith('/e/x/'))).toEqual([]);
  });

  test('before the pool is ready: no button after the daily, and ?survival (even with asof) stays closed', async ({ page }) => {
    await setArm(page, 'cta');
    await openAt(page, NBA_FIRST);
    await finishDaily(page);
    await expect(page.getByRole('button', { name: /Try Survival/ })).toHaveCount(0);
    await page.goto('/?survival&asof=2027-01-10');
    await expect(page.getByText(/Not open yet/)).toBeVisible();
    await expect(page.getByText('Preview build')).toHaveCount(0);
  });

  test('once the pool is ready: a quiet button after today’s daily, and fixed, non-identifying events', async ({ page }) => {
    await setArm(page, 'cta');
    await openAt(page, at('2026-12-20'));
    await finishDaily(page);
    await page.getByRole('button', { name: /Try Survival/ }).click();
    await page.getByRole('button', { name: 'Start a run' }).click();
    await expect(page.getByText('Survival · Round 1 of 20')).toBeVisible();
    await play(page, false, KEY);
    await page.getByRole('button', { name: 'See your run' }).click();
    await expect(page.getByRole('heading', { name: 'Out in round one.' })).toBeVisible();
    const v = await views(page);
    expect(v).toContain('/e/survival/start/cta');
    expect(v).toContain('/e/x/survival-cta/cta/click');
    expect(v).toContain('/e/survival/end/r1-4/miss');
    // Every path is from the fixed vocabulary: no ids, answers or numbers beyond buckets.
    for (const p of v.filter((x) => x.startsWith('/e/survival'))) expect(p).toMatch(/^\/e\/survival\/(start\/(cta|link|again)|reach\/r(5|10|15)|end\/r\d+-\d+\/(miss|short)|win|share\/[a-z]+)$/);
    // The Daily Five run of that day is still complete and counted once.
    expect(v.filter((x) => x.startsWith('/e/complete/daily/'))).toHaveLength(1);
    await page.getByRole('button', { name: 'Run it again' }).click();
    await expect.poll(() => views(page)).toContain('/e/survival/start/again');
  });
});
