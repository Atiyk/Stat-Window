import { expect, test, type Page } from '@playwright/test';
import { collectErrors, DAY2, lockAndSettle, next, openAt, typeWindow } from './helpers';

// Friend Ghost Race (challenge link v2): the friend's five round scores travel in the
// link, and each one appears only after the recipient finishes the same round.

const RACE = '/?day=2026-11-16&vs=247&time=61000&v=2&r=48.61.0.100.38';
const AFTER_MIDNIGHT = new Date('2026-11-17T05:05:00Z');

async function sharedText(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Challenge a friend' }).click();
  await expect.poll(() => page.evaluate(() => document.body.dataset.shared ?? '')).not.toBe('');
  return page.evaluate(() => document.body.dataset.shared!);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { document.body.dataset.shared = t; } } });
  });
});

test('a race link reveals the friend round by round, then compares every round', async ({ page }) => {
  const errors = collectErrors(page);
  await openAt(page, AFTER_MIDNIGHT, RACE);
  // The total stays out of the note: with it, the friend's last round could be worked out before it is played.
  await expect(page.locator('.challenge-note')).toHaveText('Race your friend, one question at a time.');
  // The court is on for the race, and nothing about the friend's rounds shows before a reveal.
  await expect(page.locator('.live-court')).toBeVisible();
  await expect(page.locator('.race-line')).toHaveText('');
  await expect(page.locator('[data-court-friend]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Friend 48');

  await typeWindow(page, 70, 75); // Bonds, 73: 89 points
  await lockAndSettle(page);
  await expect(page.locator('.race-line')).toContainText('Friend 48');
  await expect(page.locator('.race-line')).toContainText('up 41');
  await expect(page.locator('[data-court-friend]')).toHaveAttribute('data-court-friend', '48');
  // Only round one: the later rounds (61, 100, 38) are not on the page.
  await expect(page.locator('.race-line')).not.toContainText('109');
  await next(page);
  await expect(page.locator('.race-line')).toContainText('Friend 48');
  await lockAndSettle(page);
  await expect(page.locator('.race-line')).toContainText('Friend 109');

  // A refresh keeps the race and the equivalent-round standing.
  await page.reload();
  await expect(page.locator('.race-line')).toContainText('Friend 109');
  for (let i = 2; i < 5; i++) {
    await next(page);
    await lockAndSettle(page);
  }
  await expect(page.locator('.race-line')).toContainText('Friend 247');
  await next(page);

  const race = page.locator('.race-result');
  await expect(race).toBeVisible();
  await expect(race.locator('h2')).toHaveText(/^(You won by \d+ points?\.|Your friend won by \d+ points?\.|Tied at \d+\.|You won on time, tied at \d+\.|Your friend won on time, tied at \d+\.)$/);
  await expect(race.locator('tr[data-row="friend"] td')).toHaveText(['48', '61', '0', '100', '38', '247']);
  await expect(race.locator('tr[data-row="you"] td')).toHaveCount(6);
  // The legacy total-only line is not shown twice.
  await expect(page.locator('.versus')).toHaveCount(0);

  // The recipient's own link is a race link too, with no answers or question text in it.
  const text = await sharedText(page);
  const url = new URL(text.match(/https?:\/\/\S+/)![0]);
  expect([...url.searchParams.keys()].sort()).toEqual(['day', 'r', 'time', 'v', 'vs']);
  const rounds = url.searchParams.get('r')!.split('.').map(Number);
  expect(rounds.reduce((a, b) => a + b, 0)).toBe(Number(url.searchParams.get('vs')));
  expect(errors).toEqual([]);
});

test('legacy and tampered links keep working without a race', async ({ page }) => {
  // Legacy: total only. No race line, the old final comparison.
  await openAt(page, AFTER_MIDNIGHT, '/?day=2026-11-16&vs=247');
  await expect(page.locator('.challenge-note')).toContainText('Beat your friend’s 247');
  await expect(page.locator('.race-line')).toHaveCount(0);

  // Tampered: rounds that do not add up. Same five questions, no friend score at all.
  await openAt(page, AFTER_MIDNIGHT, '/?day=2026-11-16&vs=300&time=61000&v=2&r=48.61.0.100.38');
  await expect(page.locator('.challenge-note')).toHaveText('A friend sent you these five.');
  await expect(page.locator('.race-line')).toHaveCount(0);
});

test('the sender’s link carries five round scores that add up to the total', async ({ page }) => {
  await openAt(page, DAY2);
  await typeWindow(page, 70, 75);
  for (let i = 0; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  const total = Number(await page.locator('.results-score').textContent());
  const text = await sharedText(page);
  const url = new URL(text.match(/https?:\/\/\S+/)![0]);
  expect(url.searchParams.get('vs')).toBe(String(total));
  expect(url.searchParams.get('v')).toBe('2');
  expect(url.searchParams.get('r')).toMatch(/^\d{1,3}(\.\d{1,3}){4}$/);
});
