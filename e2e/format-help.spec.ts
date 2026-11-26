/**
 * Workstream T: layered onboarding, contextual format guidance and replayable
 * per-format worked examples. Screenshots go to /home/user/work/shots/t/ when
 * SHOTS_DIR is set (or that default exists).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FORMATS } from '../src/content/formats';
import { FORMAT_GUIDE } from '../src/content/teaching';
import { FAMILIARITY_KEY } from '../src/lib/format-familiarity';
import { SAVE_KEY } from '../src/engine/storage';
import { lowBracket, lockAndSettle, next } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? '/home/user/work/shots/t';
const shoot = async (page: Page, name: string) => {
  if (!existsSync('/home/user/work')) return;
  mkdirSync(SHOTS, { recursive: true });
  // Let open/close transitions finish so the picture shows the settled screen.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

const BETA_DAY = new Date('2026-11-26T15:00:00Z');
/** A mixed-format official-style slate: missing point, reference, recall, reference, recall. */
const MIXED_DAY = new Date('2026-12-03T15:00:00Z');

async function seed(page: Page, introSeen: boolean, extra: Record<string, unknown> = {}) {
  await page.addInitScript(({ key, save }) => {
    if (!sessionStorage.getItem('__seeded')) {
      localStorage.setItem(key, JSON.stringify(save));
      sessionStorage.setItem('__seeded', '1');
    }
  }, { key: SAVE_KEY, save: { version: 1, runs: {}, settings: { sound: false, introSeen }, ...extra } });
}

const snapshot = (page: Page) => page.evaluate(() => {
  const local: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    // Familiarity is its own key and the only one examples may never touch either.
    local[k] = localStorage.getItem(k)!;
  }
  const session: Record<string, string> = {};
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i)!;
    session[k] = sessionStorage.getItem(k)!;
  }
  return { local, session };
});

const guide = (page: Page) => page.getByRole('dialog');
const noHorizontalScroll = (page: Page) => page.evaluate(() => {
  const d = document.querySelector('dialog[open]');
  return document.documentElement.scrollWidth <= innerWidth + 1 && (!d || d.scrollWidth <= d.clientWidth + 1);
});

async function playExample(page: Page) {
  const dialog = guide(page);
  await dialog.getByRole('slider', { name: 'Low end of your window' }).focus();
  await page.keyboard.press('PageUp');
  await page.keyboard.press('ArrowRight');
  await dialog.getByRole('button', { name: 'Lock the window' }).click();
  await expect(dialog.locator('.teaching-story')).toBeVisible();
}

test.describe('first use', () => {
  test('a new player gets a short, skippable, interactive walkthrough that teaches through play', async ({ page }) => {
    await page.clock.install({ time: BETA_DAY });
    await page.goto('/');
    const intro = page.locator('.onboarding-play');
    await expect(intro.getByRole('heading', { level: 1 })).toHaveText(/2015–16 Golden State Warriors/);
    await expect(intro.locator('.onboarding-coach')).toHaveText(/Drag either bracket, or tap a big number/);
    await expect(intro.locator('.live-court')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip tutorial and start' })).toBeVisible();
    // Drag the high bracket with a pointer.
    const hi = intro.getByRole('slider', { name: 'High end of your window' });
    const box = (await hi.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 20, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(intro.locator('.onboarding-coach')).toHaveText(/Tighter is worth more|Still worth 0/);
    // Then type an exact low end that puts 73 on the edge: inclusive capture.
    await intro.getByRole('button', { name: /^High end: / }).click();
    await page.getByRole('textbox', { name: /^High end, between/ }).fill('78');
    await page.keyboard.press('Enter');
    await intro.getByRole('button', { name: /^Low end: / }).click();
    await page.getByRole('textbox', { name: /^Low end, between/ }).fill('73');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Lock the window' }).click();
    const story = intro.locator('.teaching-story');
    await expect(story).toContainText('Inside: +');
    await expect(story).toContainText('edges count');
    await expect(story).toContainText(/half as wide would earn \d+/);
    await expect(intro.locator('.teaching-court__caption')).toContainText('moves the ball up the court');
    await expect(intro.locator('.live-court')).toHaveAttribute('data-total', /^[1-9]\d*$/);
    // Not an official attempt: nothing saved, no clock, no run analytics.
    const state = await snapshot(page);
    expect(JSON.parse(state.local[SAVE_KEY] ?? '{"runs":{}}').runs['2026-11-26']?.results ?? []).toEqual([]);
    expect(Object.keys(state.session).filter((k) => k.startsWith('stat-window:shot'))).toEqual([]);
    expect(Object.keys(JSON.parse(state.local['stat-window:sent'] ?? '{}')).filter((k) => /^(start|touch):/.test(k))).toEqual([]);
    await page.getByRole('button', { name: "Start today's five" }).click();
    await expect(page.locator('.round:not(.onboarding-play) .question')).toBeVisible();
    await expect(page.locator('.format-cue')).toBeVisible();
  });

  test('a miss explains the narrow-window risk; a near-full window explains the zero', async ({ page }) => {
    await page.clock.install({ time: BETA_DAY });
    await page.goto('/');
    const intro = page.locator('.onboarding-play');
    await intro.getByRole('slider', { name: 'High end of your window' }).focus();
    await page.keyboard.press('Home');
    await page.getByRole('button', { name: 'Lock the window' }).click();
    await expect(intro.locator('.teaching-story')).toContainText('scores 0 however tight');
    await page.getByRole('button', { name: 'Try another window' }).click();
    await intro.getByRole('slider', { name: 'Low end of your window' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Lock the window' }).click();
    await expect(intro.locator('.teaching-story')).toContainText('Inside, but too wide to score.');
    await expect(intro.locator('.teaching-story')).toContainText('worth 0');
  });

  test('skip starts the daily at once and is remembered', async ({ page }) => {
    await page.clock.install({ time: BETA_DAY });
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip tutorial and start' }).click();
    await expect(page.locator('.round:not(.onboarding-play) .question')).toBeVisible();
    await expect(page.locator('.shot-clock')).toContainText('24s');
    expect(JSON.parse((await snapshot(page)).local[SAVE_KEY]!).settings.introSeen).toBe(true);
  });

  test('time to first meaningful action (lab measurement)', async ({ page }, info) => {
    // Real clock: the measurement uses performance.now from navigation start.
    await page.addInitScript(() => {
      const w = window as unknown as { __ttfma: { ready?: number; first?: number } };
      w.__ttfma = {};
      new MutationObserver((_, obs) => {
        if (document.querySelector('.onboarding-play [role="slider"]')) { w.__ttfma.ready = performance.now(); obs.disconnect(); }
      }).observe(document, { subtree: true, childList: true });
      const first = (e: Event) => {
        if (w.__ttfma.first === undefined && (e.target as Element | null)?.closest?.('.ruler, .readout')) w.__ttfma.first = performance.now();
      };
      addEventListener('pointerdown', first, true);
      addEventListener('keydown', first, true);
    });
    await page.goto('/');
    const hi = page.getByRole('slider', { name: 'High end of your window' });
    await expect(hi).toBeVisible();
    const box = (await hi.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 30, box.y + box.height / 2, { steps: 3 });
    await page.mouse.up();
    const m = await page.evaluate(() => (window as unknown as { __ttfma: { ready: number; first: number } }).__ttfma);
    expect(m.ready).toBeGreaterThan(0);
    expect(m.first).toBeGreaterThanOrEqual(m.ready);
    const line = `TTFMA lab (${info.project.name}): bracket interactive at ${Math.round(m.ready)} ms after navigation start; first bracket input at ${Math.round(m.first)} ms (scripted, no think time)`;
    console.log(line);
    if (existsSync('/home/user/work')) {
      mkdirSync(SHOTS, { recursive: true });
      writeFileSync(`${SHOTS}/ttfma-${info.project.name}.json`, JSON.stringify({ project: info.project.name, readyMs: m.ready, firstInputMs: m.first, note: line }, null, 2));
    }
  });
});

test.describe('returning and linked players', () => {
  test('a returning player is never shown the walkthrough, and reaches the guide from the pregame screen', async ({ page }) => {
    await seed(page, true);
    await page.clock.install({ time: BETA_DAY });
    await page.goto('/');
    await expect(page.locator('.ready-card')).toBeVisible();
    await expect(page.locator('.onboarding-play')).toHaveCount(0);
    // The returning-player home places the guide as a quiet secondary row.
    await page.locator('.home-more__row', { hasText: 'How to play' }).click();
    await expect(guide(page)).toBeVisible();
    await expect(guide(page).getByRole('heading', { name: 'How to play' })).toBeVisible();
    for (const f of FORMATS) await expect(guide(page).locator(`[data-guide-open="${f}"]`)).toContainText(FORMAT_GUIDE[f].label);
  });

  test('a direct challenge link skips onboarding friction and goes to the game', async ({ page }) => {
    await page.clock.install({ time: BETA_DAY });
    await page.goto('/?day=2026-11-25&vs=200');
    await expect(page.locator('.onboarding-play')).toHaveCount(0);
    await page.getByRole('button', { name: "Start today's five" }).click();
    await expect(page.locator('.challenge-note')).toContainText('200');
    await expect(page.locator('.shot-clock')).toContainText(/\d+s/);
  });

  test('refresh and a second tab: the walkthrough is seen once, nothing is saved by it', async ({ context }) => {
    const a = await context.newPage();
    await a.clock.install({ time: BETA_DAY });
    await a.goto('/');
    await expect(a.locator('.onboarding-play')).toBeVisible();
    await a.reload();
    await expect(a.locator('.onboarding-play')).toBeVisible();
    await a.getByRole('button', { name: 'Skip tutorial and start' }).click();
    await expect(a.locator('.round:not(.onboarding-play) .question')).toBeVisible();
    const b = await context.newPage();
    await b.clock.install({ time: BETA_DAY });
    await b.goto('/');
    await expect(b.locator('.round .question, .ready-card').first()).toBeVisible();
    await expect(b.locator('.onboarding-play')).toHaveCount(0);
  });
});

test.describe('the guide: one replayable worked example per format', () => {
  for (const [w, h] of [[390, 844], [320, 568]] as const) {
    test(`every format's example plays, explains and replays at ${w}×${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page, true);
      await page.clock.install({ time: BETA_DAY });
      await page.goto('/');
      await expect(page.locator('.ready-card')).toBeVisible();
      const before = await snapshot(page);
      await page.getByRole('button', { name: 'How to play', exact: true }).click();
      await expect(guide(page)).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      await shoot(page, `guide-${w}x${h}`);
      await guide(page).locator('.guide-types').scrollIntoViewIfNeeded();
      await shoot(page, `guide-types-${w}x${h}`);
      for (const f of ['intro', ...FORMATS] as const) {
        await guide(page).locator(`[data-guide-open="${f}"]`).click();
        const play = guide(page).locator('.guide-play');
        await expect(play.getByRole('heading', { level: 3 })).toBeFocused();
        await expect(play.locator('.shot-clock')).toHaveCount(0);
        if (f === 'missing-point') {
          const chart = play.locator('.q-chart');
          await expect(chart).toBeVisible();
          await expect(chart.locator('.sr-only')).toContainText('hidden, your estimate');
          await expect(chart).not.toContainText('64');
        }
        expect(await noHorizontalScroll(page)).toBe(true);
        await shoot(page, `example-${f}-${w}x${h}`);
        await playExample(page);
        const story = play.locator('.teaching-story');
        await expect(story).toHaveAttribute('data-feedback', /^(hit|zero|miss)$/);
        await expect(story.locator('.teaching-why').first()).toContainText(/Inside|Outside/);
        if (f !== 'intro') await expect(story).toContainText(FORMAT_GUIDE[f].example.why);
        await expect(story).toBeFocused();
        await page.waitForTimeout(400); // let the reveal settle before the screenshot
        await shoot(page, `example-${f}-resolved-${w}x${h}`);
        // Replay resets the same example, untimed.
        await guide(page).getByRole('button', { name: 'Replay this example' }).click();
        await expect(play.locator('.teaching-story')).toHaveCount(0);
        await expect(guide(page).getByRole('button', { name: 'Pull the brackets in first' })).toBeDisabled();
        await guide(page).getByRole('button', { name: 'Back to question types' }).click();
        await expect(guide(page).locator(`[data-guide-open="${f}"]`)).toBeFocused();
      }
      await guide(page).getByRole('button', { name: 'Close' }).click();
      await expect(guide(page)).toBeHidden();
      // No save, score, analytics or familiarity pollution from any example.
      expect(await snapshot(page)).toEqual(before);
    });
  }

  test('keyboard and reduced motion: open, choose, play, close without a pointer', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(page, true);
    await page.clock.install({ time: BETA_DAY });
    await page.goto('/');
    await expect(page.locator('.ready-card')).toBeVisible();
    const helpButton = page.getByRole('button', { name: 'How to play', exact: true });
    await helpButton.focus();
    await page.keyboard.press('Enter');
    await expect(guide(page).getByRole('heading', { name: 'How to play' })).toBeFocused();
    await guide(page).locator('[data-guide-open="ratio"]').focus();
    await page.keyboard.press('Enter');
    await expect(guide(page).locator('.guide-play h3')).toBeFocused();
    await page.keyboard.press('Tab');
    // Tab reaches the typed bound, then the sliders; use the slider keys, Enter locks.
    await guide(page).getByRole('slider', { name: 'Low end of your window' }).focus();
    await page.keyboard.press('PageUp');
    await page.keyboard.press('Enter');
    // Reduced motion: the answer lands at once, focus moves to it.
    await expect(guide(page).locator('.teaching-story')).toBeFocused();
    await expect(guide(page).locator('.sr-only[role="status"]')).toContainText('Answer: 59 percent');
    await page.keyboard.press('Escape');
    await expect(guide(page)).toBeHidden();
    await expect(helpButton).toBeFocused();
  });
});

test.describe('contextual guidance during a timed, mixed-format daily', () => {
  test('help opened mid-question never pauses the clock; it expires with help open', async ({ page }) => {
    await seed(page, true);
    await page.clock.install({ time: MIXED_DAY });
    await page.goto('/');
    await page.getByRole('button', { name: "Start today's five" }).click();
    const cue = page.locator('.round .format-cue');
    await expect(cue).toHaveAttribute('data-format', 'missing-point');
    await expect(cue).toContainText(FORMAT_GUIDE['missing-point'].instruction);
    await expect(cue.locator('.format-cue__new')).toBeVisible();
    // The in-round "?" expands in place; no overlay, and the clock keeps counting.
    await page.getByRole('button', { name: 'About missing data point questions' }).click();
    await expect(cue.locator('.format-cue__detail')).toBeVisible();
    await expect(cue.locator('.format-cue__detail')).toContainText('The shot clock keeps running');
    await shoot(page, 'round-format-cue-open-390');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.clock.runFor(3000);
    const clock = async () => Number((await page.locator('.round .shot-clock').textContent())?.match(/(\d+)s/)?.[1]);
    const t1 = await clock();
    expect(t1).toBeLessThanOrEqual(21);
    // The header guide opens on request, says the clock runs, and holds the examples.
    await page.getByRole('button', { name: 'How to play', exact: true }).click();
    await expect(guide(page).locator('.guide-live')).toContainText('still running');
    await expect(guide(page).locator('[data-guide-open="missing-point"]')).toBeDisabled();
    await shoot(page, 'guide-clock-live-390');
    await page.clock.runFor(5000);
    expect(await clock()).toBeLessThanOrEqual(t1 - 4);
    // Expiry while the guide is open: the round times out exactly as without it.
    await page.clock.runFor(20_000);
    await expect(page.locator('.round .outcome-word')).toHaveText('Time’s up.');
    await expect(guide(page).locator('[data-guide-open="missing-point"]')).toBeEnabled();
    await expect(guide(page).locator('.guide-live')).toHaveCount(0);
    await guide(page).getByRole('button', { name: 'Close' }).click();
    const saved = JSON.parse((await snapshot(page)).local[SAVE_KEY]!);
    expect(saved.runs['2026-12-03'].results[0]).toMatchObject({ timedOut: true, points: 0 });
    // After the round resolves the deeper example is one tap away, and the format is now familiar.
    await expect(page.getByRole('button', { name: 'About missing data point questions' })).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Try a worked missing data point example' }).click();
    await expect(guide(page).locator('.guide-play .q-chart')).toBeVisible();
    await guide(page).getByRole('button', { name: 'Close' }).click();
    expect(JSON.parse((await snapshot(page)).local[FAMILIARITY_KEY]!)).toContain('missing-point');
    // A new format mid-slate gets its own cue once; plain recall never shows the tag.
    await next(page);
    await expect(cue).toHaveAttribute('data-format', 'reference');
    await expect(cue.locator('.format-cue__new')).toBeVisible();
    await lockAndSettle(page);
    await next(page);
    await expect(cue).toHaveAttribute('data-format', 'recall');
    await expect(cue.locator('.format-cue__new')).toHaveCount(0);
    await lockAndSettle(page);
    await next(page);
    // Repeat exposure of reference in the same slate: no tag.
    await expect(cue).toHaveAttribute('data-format', 'reference');
    await expect(cue.locator('.format-cue__new')).toHaveCount(0);
  });

  test('repeat exposures across refreshes do not nag', async ({ page }) => {
    await seed(page, true);
    await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify(['missing-point'])), FAMILIARITY_KEY);
    await page.clock.install({ time: MIXED_DAY });
    await page.goto('/');
    await page.getByRole('button', { name: "Start today's five" }).click();
    await expect(page.locator('.round .format-cue')).toHaveAttribute('data-format', 'missing-point');
    await expect(page.locator('.round .format-cue__new')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.round .format-cue__new')).toHaveCount(0);
  });

  test('missing metadata falls back to recall guidance', async ({ page }) => {
    await seed(page, true);
    await page.clock.install({ time: new Date('2026-11-17T15:00:00Z') });
    await page.goto('/');
    await page.getByRole('button', { name: "Start today's five" }).click();
    await expect(page.locator('.round .format-cue')).toHaveAttribute('data-format', 'recall');
    await expect(page.locator('.round .format-cue')).toContainText(FORMAT_GUIDE.recall.instruction);
  });

  test('a tutorial example cannot reset or overwrite a partially completed daily', async ({ page }) => {
    await seed(page, true);
    await page.clock.install({ time: MIXED_DAY });
    await page.goto('/');
    await page.getByRole('button', { name: "Start today's five" }).click();
    await lowBracket(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Lock the window' }).click();
    await expect(page.locator('.round .story')).toBeVisible();
    const before = await snapshot(page);
    await page.getByRole('button', { name: 'How to play', exact: true }).click();
    for (const f of ['intro', 'ranking', 'difference'] as const) {
      await guide(page).locator(`[data-guide-open="${f}"]`).click();
      await playExample(page);
      await guide(page).getByRole('button', { name: 'Back to question types' }).click();
    }
    await guide(page).getByRole('button', { name: 'Close' }).click();
    expect(await snapshot(page)).toEqual(before);
    await expect(page.locator('.round .story')).toBeVisible();
    await next(page);
    await expect(page.locator('.round-meta')).toContainText('Question 2 of 5');
    await page.reload();
    await expect(page.locator('.round-meta')).toContainText('Question 2 of 5');
  });
});
