import { expect, test, type Page } from '@playwright/test';
import { collectErrors, DAY2, lockAndSettle, next, openAt, typeWindow } from './helpers';

// Day 2 (content/days/2026-11-16.json) opens with Barry Bonds; day 3 with the 1995–96 Bulls.
const BONDS = 'Barry Bonds';

async function playOut(page: Page, from = 0) {
  for (let i = from; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-title')).toBeVisible();
}

test('a friend opens a challenge link after Eastern midnight and gets the same five questions', async ({ browser }) => {
  // Sender: plays No. 2 on Nov 16 in their own browser.
  const sender = await browser.newContext();
  const a = await sender.newPage();
  await openAt(a, DAY2);
  await expect(a.locator('.question')).toContainText(BONDS);
  await typeWindow(a, 70, 75); // 5 of 70 steps around 73: round(100 * (65/69)^2) = 89
  await lockAndSettle(a);
  await next(a);
  await playOut(a, 1);
  const total = Number(await a.locator('.results-score').textContent());
  expect(total).toBeGreaterThanOrEqual(89);
  await sender.close();

  // Recipient: a clean browser, opening the link on Nov 17 UTC, after the sender's day rolled over.
  const recipient = await browser.newContext();
  const b = await recipient.newPage();
  const errors = collectErrors(b);
  await openAt(b, new Date('2026-11-17T05:05:00Z'), `/?day=2026-11-16&vs=${total}`);
  await expect(b.locator('.question')).toContainText(BONDS);
  await expect(b.locator('.day-label')).toHaveText('No. 2');
  await expect(b.locator('.round-meta')).toContainText('Question 1 of 5');
  await expect(b.locator('.challenge-note')).toContainText(`Beat your friend’s ${total}`);
  // No spoilers before play: the answer and its note are not on the page yet.
  await expect(b.locator('.story')).toHaveCount(0);

  // A refresh part-way through keeps the recipient's own saved run.
  await lockAndSettle(b);
  await next(b);
  await b.reload();
  await expect(b.locator('.round-meta')).toContainText('Question 2 of 5');
  await playOut(b, 1);
  await expect(b.locator('.results-head')).toContainText('Challenge · No. 2');
  await expect(b.locator('.results-head')).toContainText('not counted in your stats');
  await expect(b.locator('.versus')).toContainText(`Your friend leads by`);

  // Their own daily (No. 3) is untouched and still to play.
  await b.getByRole('button', { name: 'Play today’s puzzle' }).click();
  await expect(b.locator('.day-label')).toHaveText('No. 3');
  await expect(b.locator('.round-meta')).toContainText('Question 1 of 5');
  await expect(b).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
  await recipient.close();
});

test('a link for today plays the official daily, with the friend’s score shown', async ({ page }) => {
  await openAt(page, DAY2, '/?day=2026-11-16&vs=120');
  await expect(page.locator('.day-label')).toHaveText('No. 2');
  await expect(page.locator('.challenge-note')).toContainText('120');
  await playOut(page);
  await expect(page.locator('.stats')).toContainText('Played1');
  await expect(page.locator('.versus')).toContainText('120');
});

test('future, malformed and tampered links fall back to today without leaking anything', async ({ page }) => {
  const errors = collectErrors(page);
  for (const q of ['/?day=2026-11-20', '/?day=2026-11-20&vs=300', '/?day=not-a-day&vs=9999', '/?day=2026-02-30', '/?vs=<script>', '/?day=2030-01-01']) {
    await openAt(page, DAY2, q);
    await expect(page.locator('.question')).toContainText(BONDS);
    await expect(page.locator('.day-label')).toHaveText('No. 2');
    await expect(page.locator('.challenge-note')).toHaveCount(0);
  }
  // A link with no score still says where the five came from.
  await openAt(page, DAY2, '/?day=2026-11-15');
  await expect(page.locator('.challenge-note')).toHaveText('A friend sent you these five.');
  // An out-of-range score is dropped but the day still opens.
  await openAt(page, DAY2, '/?day=2026-11-15&vs=9999');
  await expect(page.locator('.question')).toContainText('Golden State Warriors');
  await expect(page.locator('.challenge-note')).toHaveText('A friend sent you these five.');
  expect(errors).toEqual([]);
});

test('a run in progress at Eastern midnight is finished on its own day, then today opens', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-16T04:59:50Z') });
  await page.goto('/');
  await expect(page.locator('.question')).toBeVisible();
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await lockAndSettle(page);
  await next(page);
  await page.clock.fastForward('00:15');
  // Still No. 1, round 2: midnight does not pull the player out of a run.
  await expect(page.locator('.day-label')).toHaveText('No. 1');
  await expect(page.locator('.round-meta')).toContainText('Question 2 of 5');
  await playOut(page, 1);
  await expect(page.locator('.stats')).toContainText('Played1');
  await page.getByRole('button', { name: 'Play today’s puzzle' }).click();
  await expect(page.locator('.day-label')).toHaveText('No. 2');
  await expect(page.locator('.question')).toContainText(BONDS);
});

test('sharing falls back to selectable text when there is no share sheet or clipboard', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  await openAt(page, DAY2);
  await playOut(page);
  await page.getByRole('button', { name: 'Challenge a friend' }).click();
  const box = page.getByRole('textbox', { name: 'Your result to copy' });
  await expect(box).toBeVisible();
  await expect(box).toHaveValue(/\/\?day=2026-11-16&vs=\d+&time=\d+$/);
  await expect(box).toHaveValue(/Same five questions/);
});

test('practice runs of earlier days are saved, so a refresh does not re-roll them', async ({ page }) => {
  await openAt(page, DAY2);
  await playOut(page);
  await page.getByRole('button', { name: 'Nov 15' }).click();
  await expect(page.locator('.round-meta')).toContainText('Practice');
  await lockAndSettle(page);
  await next(page);
  await page.reload();
  // Reload goes back to today (finished); the practice run waits where it was left.
  await expect(page.locator('.results-title')).toBeVisible();
  await page.getByRole('button', { name: 'Nov 15' }).click();
  await expect(page.locator('.round-meta')).toContainText('Question 2 of 5');
  await expect(page.locator('.stats')).toHaveCount(0);
});
