import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { normalizeWindow } from '../src/engine/game';
import { scoreWindow, type Scored } from '../src/engine/scoring';
import { NBA_DAYS } from './helpers';
import { openFold } from './results-helpers';

const day = NBA_DAYS[8]!;
const dates = NBA_DAYS.slice(6, 9);
const saveRuns = (advanced: number) => Object.fromEntries(dates.map((date, dayIndex) => {
  const { questions } = JSON.parse(readFileSync(new URL(`../content/days/${date}.json`, import.meta.url), 'utf8')) as {
    questions: (Scored & { id: string })[];
  };
  return [date, {
    results: questions.map((q, index) => {
      const { answer, min, max, step } = q;
      const miss = dayIndex !== 2 && index === 4;
      const window = normalizeWindow(q, miss
        ? (answer > min + step ? { lo: min, hi: min + step } : { lo: max - step, hi: max })
        : (answer === min ? { lo: min, hi: min + step } : { lo: answer - step, hi: answer }));
      return { questionId: q.id, ...window, ...scoreWindow(q, window), elapsedMs: 5000 };
    }),
    advanced: dayIndex === 2 ? advanced : 5,
  }];
}));

test('one earned takeaway on completion, no repeat after refresh, and past games disclose in order', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date(`${day}T15:00:00Z`));
  await page.route('**/api/scores', async (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.addInitScript((runs) => {
    if (!localStorage.getItem('stat-window:v1')) {
      localStorage.setItem('stat-window:v1', JSON.stringify({ version: 1, runs, settings: { introSeen: true, sound: false } }));
    }
  }, saveRuns(4));
  await page.goto('/');
  await page.getByRole('button', { name: 'See your day' }).click();
  await expect(page.getByRole('heading', { name: 'Score 500 of 500' })).toBeVisible();
  await expect(page.locator('.results-verdict')).toHaveText('New personal best by 100 points.');
  await expect(page.getByText('3 days in a row.', { exact: true })).toHaveCount(0);
  await expect(page.locator('.scorecard .ledger-cell')).toHaveCount(5);
  await expect(page.locator('.scorecard .ledger-cell').first()).toHaveCSS('animation-name', 'none');

  await openFold(page, 'Practice a past game');
  const archive = page.getByRole('region', { name: 'Past games' });
  const days = archive.getByRole('list').getByRole('listitem');
  await expect(days).toHaveCount(5);
  const recent = await days.allTextContents();
  const disclose = archive.getByRole('button', { name: 'View all past games' });
  await expect(disclose).toHaveAttribute('aria-expanded', 'false');
  await disclose.focus();
  await page.keyboard.press('Enter');
  const collapse = archive.getByRole('button', { name: 'Show recent games' });
  await expect(collapse).toBeFocused();
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  expect(await days.count()).toBeGreaterThan(5);
  expect((await days.allTextContents()).slice(0, 5)).toEqual(recent);
  await collapse.click();
  await expect(days).toHaveCount(5);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Score 500 of 500' })).toBeVisible();
  await expect(page.locator('.results-verdict')).toHaveText('5 perfect windows.');
  await expect(page.locator('.scorecard')).not.toHaveAttribute('data-arrive');
  await openFold(page, 'Practice a past game');

  await archive.getByRole('radio', { name: 'Untimed', exact: true }).check();
  await days.first().getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`\\?practice=${dates[1]}$`));
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeVisible();
});

test('the five score cells stagger only when newly finished', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.setFixedTime(new Date(`${day}T15:00:00Z`));
  await page.route('**/api/scores', async (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.addInitScript((runs) => {
    if (!localStorage.getItem('stat-window:v1')) {
      localStorage.setItem('stat-window:v1', JSON.stringify({ version: 1, runs, settings: { introSeen: true, sound: false } }));
    }
  }, saveRuns(4));
  await page.goto('/');
  await page.getByRole('button', { name: 'See your day' }).click();

  const cells = page.getByRole('list', { name: 'Question by question' }).getByRole('listitem');
  await expect(cells.first()).toHaveCSS('animation-name', 'result-arrive');
  await expect(cells.last()).toHaveCSS('animation-delay', '0.12s');
  const share = page.getByRole('button', { name: 'Challenge a friend' });
  await expect(share).toBeEnabled();
  await expect(share).toBeInViewport();
  await page.reload();
  await expect(cells.first()).toHaveCSS('animation-name', 'none');
});

test('perfect scores fit inside all five cells at 320px with 200% text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.clock.setFixedTime(new Date(`${day}T15:00:00Z`));
  await page.route('**/api/scores', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.addInitScript((runs) => {
    localStorage.setItem('stat-window:v1', JSON.stringify({ version: 1, runs, settings: { introSeen: true, sound: false } }));
  }, saveRuns(5));
  await page.goto('/');
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const cells = page.locator('.scorecard .ledger-cell');
  await expect(cells).toHaveCount(5);
  for (const cell of await cells.all()) {
    const value = cell.locator('.ledger-num');
    await expect(value).toHaveText('100');
    expect((await value.boundingBox())!.width).toBeLessThanOrEqual((await cell.boundingBox())!.width);
  }
});

test('clipboard success is confirmed after completion and attempts cannot overlap', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${day}T15:00:00Z`));
  await page.route('**/api/scores', async (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.addInitScript((runs) => {
    localStorage.setItem('stat-window:v1', JSON.stringify({ version: 1, runs, settings: { introSeen: true, sound: false } }));
    Object.defineProperty(navigator, 'share', { value: undefined });
    let attempts = 0;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => {
      attempts++;
      document.body.dataset.copyAttempts = String(attempts);
      return new Promise<void>((resolve, reject) => {
        window.addEventListener('complete-copy', () => resolve(), { once: true });
        window.addEventListener('reject-copy', () => reject(new Error('Clipboard denied')), { once: true });
      });
    } } });
  }, saveRuns(5));
  await page.goto('/');
  const share = page.getByRole('button', { name: 'Challenge a friend' });
  const toast = page.locator('.results .toast');
  await share.click();
  await expect(share).toHaveAttribute('aria-busy', 'true');
  await expect(toast).toBeEmpty();
  await share.dispatchEvent('click');
  await expect(page.locator('body')).toHaveAttribute('data-copy-attempts', '1');
  await page.evaluate(() => window.dispatchEvent(new Event('reject-copy')));
  const fallback = page.getByRole('textbox', { name: 'Your result to copy' });
  await expect(fallback).toBeFocused();
  await expect(toast).toHaveText('Copy the selected text');
  await share.click();
  await expect(toast).toBeEmpty();
  await page.evaluate(() => window.dispatchEvent(new Event('reject-copy')));
  await expect(fallback).toBeFocused();
  await expect(toast).toHaveText('Copy the selected text');
  await share.click();
  await expect(toast).toBeEmpty();
  await page.evaluate(() => window.dispatchEvent(new Event('complete-copy')));
  await expect(toast).toHaveText('Copied');
  await expect(fallback).toHaveCount(0);
});
