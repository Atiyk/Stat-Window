import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { NBA_DAYS } from './helpers';

const day = NBA_DAYS[8]!;
const dates = NBA_DAYS.slice(6, 9);
const saveRuns = (advanced: number) => Object.fromEntries(dates.map((date, dayIndex) => {
  const { questions } = JSON.parse(readFileSync(new URL(`../content/days/${date}.json`, import.meta.url), 'utf8')) as {
    questions: { id: string; answer: number; step: number; min: number; max: number }[];
  };
  return [date, {
    results: questions.map(({ id, answer, step, min, max }) => ({
      questionId: id, lo: Math.max(min, answer - step), hi: Math.min(max, answer + step),
      hit: true, points: dayIndex === 2 ? 100 : 80, missBy: 0, elapsedMs: 5000,
    })),
    advanced: dayIndex === 2 ? advanced : 5,
  }];
}));

test('one official milestone on completion, no repeat after refresh, and past games disclose in order', async ({ page }) => {
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
  await expect(page.getByText('New personal best: 500.')).toBeVisible();
  await expect(page.getByText('3 days in a row', { exact: true })).toBeVisible();
  await expect(page.locator('.results-score')).toHaveCSS('animation-name', 'none');

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
  await expect(page.getByText('3 days in a row', { exact: true })).toHaveCount(0);

  await archive.getByRole('radio', { name: 'Untimed', exact: true }).check();
  await days.first().getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`\\?practice=${dates[1]}$`));
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeVisible();
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
