import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parseSlate } from '../src/content/schema';
import { normalizeWindow } from '../src/engine/game';
import { scoreWindow } from '../src/engine/scoring';
import { SAVE_KEY, type SaveData } from '../src/engine/storage';
import { startDailyIfNeeded } from './helpers';

// Home (Feature E), Weekly Scoreboard (F) and Scouting Report (D), against the beta build and its real slates.
// Mon 2026-11-23 .. Sun 2026-11-29 is a full beta week; 2026-11-24 is a Tuesday.
const TODAY = '2026-11-25'; // Wednesday
const at = (day: string, time = '15:00:00') => new Date(`${day}T${time}Z`);

function runFor(day: string, pad = 1): SaveData['runs'][string] {
  const slate = parseSlate(JSON.parse(readFileSync(new URL(`../content/days/${day}.json`, import.meta.url), 'utf8')));
  const results = slate.questions.map((q) => {
    const window = normalizeWindow(q, { lo: Math.max(q.min, q.answer - q.step * pad), hi: Math.min(q.max, q.answer + q.step * pad) });
    return { questionId: q.id, ...window, ...scoreWindow(q, window) };
  });
  return { results, advanced: results.length };
}

async function seed(page: Page, now: Date, runs: SaveData['runs'] = {}, extra: Partial<SaveData> = {}) {
  await page.clock.setFixedTime(now);
  await page.addInitScript(({ key, save }) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, JSON.stringify(save));
      sessionStorage.setItem('seeded', '1');
    }
  }, { key: SAVE_KEY, save: { version: 1, runs, settings: { sound: false, introSeen: true }, ...extra } });
}

const week = (days: string[]) => Object.fromEntries(days.map((d) => [d, runFor(d)]));

test.describe('returning player, daily not started', () => {
  test('Daily Five is the dominant action; secondary options appear only when real', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-23', '2026-11-24']));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Ready for five?' })).toBeVisible();
    await expect(page.getByRole('button', { name: "Start today's five" })).toBeVisible();
    // Exactly one primary button on the page.
    await expect(page.locator('.ready-card .btn-primary')).toHaveCount(1);
    const more = page.getByRole('navigation', { name: 'More ways to play' });
    await expect(more.getByRole('button', { name: /Practice/ })).toBeVisible();
    await expect(more.getByRole('button', { name: /Scouting Report/ })).toBeVisible();
    await expect(more.getByRole('button', { name: /Weekly Scoreboard/ })).toBeVisible();
    await expect(more.getByRole('button', { name: /How to play/ })).toBeVisible();
    // Survival is not offered in this build, and nothing else is invented.
    await expect(page.getByText('Survival')).toHaveCount(0);
    await expect(page.locator('.week-glance')).toContainText('2 of 7 games');
    await expect(page.locator('.week-glance')).toContainText('This week');
  });

  test('Daily Five stays one click away', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-24']));
    await page.goto('/');
    await page.getByRole('button', { name: "Start today's five" }).click();
    await expect(page.locator('.question')).toBeVisible();
  });

  test('How to play opens the guide without starting anything', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-24']));
    await page.goto('/');
    await page.locator('.home-more__row', { hasText: 'How to play' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('.question')).toHaveCount(0);
  });

  test('practice is discoverable and keeps timed and untimed distinct', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-24']));
    await page.goto('/');
    const practice = page.getByRole('button', { name: /^Practice/ });
    await expect(practice).toHaveAttribute('aria-expanded', 'false');
    await practice.click();
    await expect(practice).toHaveAttribute('aria-expanded', 'true');
    await page.getByLabel('Untimed').check();
    await page.locator('.home-practice .archive-list button').first().click();
    await expect(page.locator('.ready-card .context')).toHaveText('Untimed practice');
    await expect(page).toHaveURL(/practice=2026-11-24/);
  });

  test('a first-day player with no history sees no empty stats', async ({ page }) => {
    await seed(page, at(TODAY));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Ready for five?' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Scouting Report/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Weekly Scoreboard/ })).toHaveCount(0);
    await expect(page.locator('.week-glance')).toHaveCount(0);
  });

  test('practice-only and beta-only history never create weekly progress', async ({ page }) => {
    await seed(page, at(TODAY), {}, { practice: week(['2026-11-24']) });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Ready for five?' })).toBeVisible();
    await expect(page.locator('.week-glance')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Scouting Report/ })).toHaveCount(0);
  });
});

test('an unfinished daily resumes directly in its round', async ({ page }) => {
  const partial = runFor(TODAY);
  await seed(page, at(TODAY), { [TODAY]: { results: partial.results.slice(0, 2), advanced: 2 } });
  await page.goto('/');
  await expect(page.locator('.question')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ready for five?' })).toHaveCount(0);
  await expect(page.locator('.round-meta')).toContainText('Question 3 of 5');
});

test.describe('daily completed', () => {
  test('shows the result, weekly progress, the next reset and Scouting access; no second attempt', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-23', '2026-11-24', TODAY]));
    await page.goto('/');
    await expect(page.locator('.results-score')).toBeVisible();
    await expect(page.getByRole('button', { name: "Start today's five" })).toHaveCount(0);
    await expect(page.locator('.week-glance')).toContainText('3 of 7 games');
    await expect(page.locator('.week-glance .week-strip__day')).toHaveCount(7);
    await expect(page.locator('.next-window')).toContainText('Next puzzle in');
    await page.getByRole('button', { name: /^Scouting Report/ }).click();
    await expect(page.getByRole('heading', { name: 'How you estimate' })).toBeVisible();
    await expect(page.locator('.scouting__metrics')).toContainText('Completed games');
  });
});

test.describe('direct destinations skip the home', () => {
  test('a challenge link opens its own Start gate', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-24']));
    await page.goto('/?day=2026-11-20&vs=300');
    await startDailyIfNeeded(page);
    await expect(page.locator('.challenge-note')).toContainText('300');
    await expect(page.getByRole('navigation', { name: 'More ways to play' })).toHaveCount(0);
  });

  test('a practice link opens untimed practice without the home', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-24']));
    await page.goto('/?practice=2026-11-20');
    await expect(page.locator('.ready-card .context')).toHaveText('Untimed practice');
    await expect(page.getByRole('navigation', { name: 'More ways to play' })).toHaveCount(0);
  });
});

test('missing inventory: an honest message, with the player’s own history still reachable', async ({ page }) => {
  await seed(page, at('2027-03-01'), week(['2026-11-24']));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /still being checked/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scouting Report' })).toBeVisible();
});

test.describe('Weekly Scoreboard', () => {
  test('shows each day honestly: completed, unplayed, open and upcoming; never a fake zero', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-23', '2026-11-25']));
    await page.goto('/?weekly');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nov 23 – Nov 29, 2026');
    const rows = page.locator('.week-row');
    await expect(rows).toHaveCount(7);
    await expect(rows.nth(1)).toContainText('Not played'); // Tuesday elapsed, no run
    await expect(rows.nth(2)).toContainText(/^Wed/); // Wednesday finished
    await expect(rows.nth(3)).toContainText('Not yet played'); // Thursday
    await expect(page.locator('.weekly__stats')).toContainText('2 of 7');
  });

  test('days before the season began are labelled, not counted as unplayed', async ({ page }) => {
    await seed(page, at('2026-11-16'), week(['2026-11-16']));
    await page.goto('/?weekly');
    await expect(page.locator('.weekly__stats')).toContainText('1 of 7');
    await page.getByRole('button', { name: 'Last week' }).click();
    const rows = page.locator('.week-row');
    await expect(rows.first()).toContainText('Before the season began');
    await expect(rows.nth(5)).toContainText('Before the season began');
    await expect(rows.nth(6)).toContainText('Not played'); // Sunday Nov 15 was a real, unplayed day
    await expect(page.locator('.weekly__stats')).toContainText('0 of 1');
  });

  test('a previous eligible week can be reviewed', async ({ page }) => {
    await seed(page, at('2026-12-01'), week(['2026-11-24', '2026-11-26']));
    await page.goto('/?weekly');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nov 30 – Dec 6, 2026');
    await page.getByRole('button', { name: 'Last week' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nov 23 – Nov 29, 2026');
    await expect(page.locator('.weekly__stats')).toContainText('2 of 7');
  });

  test('the spoiler-free share text names dates, scores, participation and invites play', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { document.body.dataset.shared = t; } } });
    });
    await seed(page, at(TODAY), week(['2026-11-23', '2026-11-25']));
    await page.goto('/?weekly');
    await page.getByRole('button', { name: 'Share this week' }).click();
    await expect.poll(() => page.evaluate(() => document.body.dataset.shared ?? '')).toContain('Stat Window weekly scorecard');
    const text = await page.evaluate(() => document.body.dataset.shared!);
    expect(text).toContain('Nov 23 – Nov 29, 2026');
    expect(text).toContain('Tue not played');
    expect(text).toMatch(/Mon \d+/);
    expect(text).toContain('2 of 7 games played');
    expect(text).toContain('Play along');
    expect(text).not.toMatch(/How many|\bwindows?\b/);
  });

  test('back returns to today’s puzzle', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-24']));
    await page.goto('/?weekly');
    await page.getByRole('button', { name: /Today’s puzzle/ }).click();
    await expect(page.getByRole('heading', { name: 'Ready for five?' })).toBeVisible();
  });
});

test.describe('Scouting Report', () => {
  test('is honest with no history', async ({ page }) => {
    await seed(page, at(TODAY));
    await page.goto('/?scouting');
    await expect(page.getByText('Your report starts after your first completed daily game')).toBeVisible();
  });

  test('small histories show counts and invent no conclusions', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-23', '2026-11-24']));
    await page.goto('/?scouting');
    await expect(page.locator('.scouting__metrics')).toContainText('Completed games2');
    await expect(page.getByText(/Your last 7 completed games/)).toHaveCount(0); // needs 7 + 7 games
    await expect(page.locator('.outcomes__list')).toContainText('scoring hits');
    await page.getByText('Risk profile', { exact: false }).first().click();
    await expect(page.locator('.scouting-table[data-x], .scouting-table').first()).toBeVisible();
    await page.getByText('Knowledge profile').click();
    await expect(page.getByText('Era not recorded')).toBeVisible(); // beta days predate structured metadata
  });

  test('a tampered record is not counted', async ({ page }) => {
    const good = runFor('2026-11-23');
    const bad = runFor('2026-11-24');
    bad.results[0] = { ...bad.results[0]!, points: 100 };
    await seed(page, at(TODAY), { '2026-11-23': good, '2026-11-24': bad });
    await page.goto('/?scouting');
    await expect(page.locator('.scouting__metrics')).toContainText('Completed games1');
    await expect(page.getByText(/couldn’t be verified/).first()).toBeVisible();
  });

  test('practice never counts', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-23']), { practice: week(['2026-11-20', '2026-11-21']) });
    await page.goto('/?scouting');
    await expect(page.locator('.scouting__metrics')).toContainText('Completed games1');
  });
});

test('midnight transition: an idle home moves to the new day and the week rolls on Monday (Eastern)', async ({ page }) => {
  // Sunday 2026-11-29 23:59:50 EST (04:59:50Z Monday).
  await page.clock.install({ time: new Date('2026-11-30T04:59:50Z') });
  await page.addInitScript(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY, save: { version: 1, runs: week(['2026-11-24', '2026-11-29']), settings: { sound: false, introSeen: true } },
  });
  await page.goto('/?weekly');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nov 23 – Nov 29, 2026');
  await page.clock.fastForward('00:45');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nov 30 – Dec 6, 2026');
  await expect(page.getByRole('button', { name: 'Last week' })).toBeVisible();
});
