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
    await expect(page.getByRole('heading', { name: 'How well do you know ball?' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Play Game \d+$/ })).toBeVisible();
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
    await page.getByRole('button', { name: /^Play Game \d+$/ }).click();
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
    await expect(page.getByRole('heading', { name: 'How well do you know ball?' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Scouting Report/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Weekly Scoreboard/ })).toHaveCount(0);
    await expect(page.locator('.week-glance')).toHaveCount(0);
  });

  test('practice-only and beta-only history never create weekly progress', async ({ page }) => {
    await seed(page, at(TODAY), {}, { practice: week(['2026-11-24']) });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'How well do you know ball?' })).toBeVisible();
    await expect(page.locator('.week-glance')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Scouting Report/ })).toHaveCount(0);
  });
});

test('an unfinished daily resumes directly in its round', async ({ page }) => {
  const partial = runFor(TODAY);
  await seed(page, at(TODAY), { [TODAY]: { results: partial.results.slice(0, 2), advanced: 2 } });
  await page.goto('/');
  await expect(page.locator('.question')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How well do you know ball?' })).toHaveCount(0);
  await expect(page.locator('.round-meta')).toContainText('Question 3 of 5');
});

test.describe('daily completed', () => {
  test('shows the result, weekly progress, the next reset and Scouting access; no second attempt', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-23', '2026-11-24', TODAY]));
    await page.goto('/');
    await expect(page.locator('.results-score')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Play Game \d+$/ })).toHaveCount(0);
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
  await seed(page, at('2027-03-01'), week(['2027-01-20'])); // an official-season day: history counts the current season
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /still being checked/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scouting Report' })).toBeVisible();
});

test.describe('Weekly Scoreboard', () => {
  test('shows each day honestly: completed, unplayed, open and upcoming; never a fake zero', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-23', '2026-11-25']));
    await page.goto('/?weekly');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nov 23 – Nov 29, 2026');
    const days = page.getByRole('list', { name: 'Day by day' }).getByRole('listitem');
    await expect(days).toHaveCount(7);
    await expect(days.nth(1)).toContainText('Tuesday Nov 24: not played'); // Tuesday elapsed, no run
    await expect(days.nth(1).locator('.week-day__note')).toHaveText('not played'); // said on screen, not by colour
    await expect(days.nth(2)).toContainText(/^Wednesday Nov 25: \d+ points/); // Wednesday finished
    await expect(days.nth(2)).toHaveAttribute('data-mark', 'score');
    await expect(days.nth(3)).toContainText('Thursday Nov 26: not yet played');
    await expect(days.nth(3).locator('.week-day__note')).toHaveText('to come');
    await expect(page.locator('.weekly__stats')).toContainText('2 of 7');
  });

  test('days before the season began are labelled, not counted as unplayed', async ({ page }) => {
    await seed(page, at('2026-11-16'), week(['2026-11-16']));
    await page.goto('/?weekly');
    await expect(page.locator('.weekly__stats')).toContainText('1 of 7');
    await expect(page.getByRole('button', { name: 'Next week' })).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(page.getByRole('button', { name: 'Previous week' })).toHaveAttribute('aria-disabled', 'true');
    const days = page.getByRole('list', { name: 'Day by day' }).getByRole('listitem');
    await expect(days.first()).toContainText('before the season began');
    await expect(days.first().locator('.week-day__note')).toHaveText('not open');
    await expect(days.nth(5)).toContainText('before the season began');
    await expect(days.nth(6)).toContainText('not played'); // Sunday Nov 15 was a real, unplayed day
    await expect(page.locator('.weekly__stats')).toContainText('0 of 1');
  });

  test('a previous eligible week can be reviewed', async ({ page }) => {
    // Official-season weeks (from the Nov 30 launch): beta weeks don't count once it has begun.
    await seed(page, at('2026-12-08'), week(['2026-12-01', '2026-12-03']));
    await page.goto('/?weekly');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dec 7 – Dec 13, 2026');
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nov 30 – Dec 6, 2026');
    await expect(page.locator('.weekly__stats')).toContainText('2 of 7');
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dec 7 – Dec 13, 2026');
  });

  test('every week back to the season start can be reviewed, and no earlier', async ({ page }) => {
    await seed(page, at('2026-12-22'), week(['2026-12-01', '2026-12-15']));
    await page.goto('/?weekly');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dec 21 – Dec 27, 2026');
    const previous = page.getByRole('button', { name: 'Previous week' });
    await previous.click();
    await expect(page.locator('.weekly__sub')).toContainText('last week');
    await previous.click();
    await expect(page.locator('.weekly__sub')).toContainText('2 weeks ago');
    await previous.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nov 30 – Dec 6, 2026');
    await expect(page.locator('.weekly__sub')).toContainText('3 weeks ago');
    await expect(page.locator('.weekly__stats')).toContainText('1 of 7');
    await expect(previous).toHaveAttribute('aria-disabled', 'true');
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

  test('the weekly image previews in square and portrait and downloads as a PNG', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-23', '2026-11-25']));
    await page.goto('/?weekly');
    const img = page.locator('.weekly-image__preview img');
    await expect(img).toHaveAttribute('alt', /Weekly scorecard image: .*Tue not played/);
    const size = () => img.evaluate((el: HTMLImageElement) => el.decode().then(() => [el.naturalWidth, el.naturalHeight]));
    expect(await size()).toEqual([1080, 1080]);
    await page.getByLabel('Portrait').check();
    await expect.poll(size).toEqual([1080, 1920]);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save image' }).click();
    expect((await download).suggestedFilename()).toBe('stat-window-week-2026-11-23-portrait.png');
    await expect(page.getByRole('status')).toHaveText('Download started');
  });

  test('back returns to today’s puzzle', async ({ page }) => {
    await seed(page, at(TODAY), week(['2026-11-24']));
    await page.goto('/?weekly');
    await page.getByRole('button', { name: /Today’s puzzle/ }).click();
    await expect(page.getByRole('heading', { name: 'How well do you know ball?' })).toBeVisible();
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
    await expect(page.locator('.profile')).toContainText('Strongest categoryNot clear yet'); // no conclusion from 10 attempts
    await expect(page.locator('.profile')).toContainText('Recent trendNot yet');
    // Each denominator says what it counts: every question for the catch rate, locked windows for risk.
    await expect(page.locator('.profile')).toContainText(/of 10 questions caught; a timeout counts as a miss/);
    await expect(page.locator('.profile')).toContainText(/% of \d+ locked windows \(timeouts left out\)/);
    await page.locator('summary', { hasText: 'Every window' }).click();
    await expect(page.locator('.outcomes__list')).toBeVisible();
    await page.locator('summary', { hasText: 'Risk profile' }).click();
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
  // Sunday 2026-12-06 23:59:50 EST (04:59:50Z Monday), inside the official season.
  await page.clock.install({ time: new Date('2026-12-07T04:59:50Z') });
  await page.addInitScript(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY, save: { version: 1, runs: week(['2026-12-01', '2026-12-06']), settings: { sound: false, introSeen: true } },
  });
  await page.goto('/?weekly');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nov 30 – Dec 6, 2026');
  await page.clock.fastForward('00:45');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dec 7 – Dec 13, 2026');
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible();
});
