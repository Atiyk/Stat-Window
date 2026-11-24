import { expect, test } from '@playwright/test';
import { DAY1, lockAndSettle, next, openAt, typeWindow } from './helpers';

test('short phones show conditional scoring, the answer first, and final-round progression', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAt(page, DAY1);

  const verdict = page.locator('.verdict-line');
  await expect(verdict).toHaveText('Pull the brackets in. Tighter windows score more.');
  await typeWindow(page, 40, 79);
  await expect(verdict).toHaveText('1 point if the answer is inside.');
  await expect(page.locator('.round-total .tabular')).toHaveText('0');
  await lockAndSettle(page);
  const story = page.getByRole('region', { name: 'About this answer' });
  await expect(story.locator('> :first-child')).toHaveText('73 wins');
  await expect(story.locator('.story-answer + .story-note')).toBeVisible();
  await expect(page.locator('.field [role="status"]')).toContainText('1 point. The answer is 73 wins.');
  await expect(page.getByRole('button', { name: 'Next question' })).toBeInViewport({ ratio: 1 });

  for (let round = 2; round <= 4; round++) {
    await next(page);
    await expect(page.locator('.round-label')).toHaveText(`Question ${round} of 5`);
    await lockAndSettle(page);
  }
  await next(page);
  await expect(page.locator('.round-label')).toHaveText('Final window · 5 of 5');
  await expect(page.getByRole('list', { name: 'Rounds' }).locator('li')).toHaveCount(5);
  await expect(page.getByRole('timer')).toHaveAttribute('aria-label', 'Shot clock: 24 seconds left');
  await expect(page.locator('.ruler-track')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a live perfect window lands on the real score everywhere and celebrates once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openAt(page, DAY1);
  await typeWindow(page, 72, 73);
  await page.getByRole('button', { name: 'Lock the window' }).click();
  const round = page.locator('.round[data-phase="resolved"]');
  await expect(round).toBeAttached();

  const landing = await round.evaluate((element) => ({
    answer: element.querySelector('.marker[data-landed] .marker-flag')?.textContent,
    points: element.querySelector('[data-perfect-window]')?.textContent,
    total: element.querySelector('.round-total .tabular')?.textContent,
    ledger: element.querySelector('.ledger-cell[data-new-result] .ledger-num')?.textContent,
  }));
  expect(landing).toEqual({ answer: '73', points: '+100', total: '100', ledger: '100' });
  await expect(page.getByRole('button', { name: 'Next question' })).toBeEnabled();

  await page.reload();
  await expect(round.locator('.outcome-points')).toHaveText('+100');
  await expect(round.locator('[data-perfect-window]')).toHaveCount(0);
});

for (const { label, lo, hi, start, distance } of [
  { label: 'one step above the window', lo: 60, hi: 72, start: 72, distance: 1 },
  { label: 'seven steps below the window', lo: 80, hi: 82, start: 73, distance: 7 },
]) {
  test(`a miss ${label} shows its exact gap, units, and zero points`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAt(page, DAY1);
    await typeWindow(page, lo, hi);
    await lockAndSettle(page);

    const units = distance === 1 ? 'win' : 'wins';
    await expect(page.locator('.outcome-miss')).toContainText(`Missed by ${distance} ${units}`);
    await expect(page.locator('.outcome-miss .outcome-score')).toHaveText('0 points');
    await expect(page.locator('.field [role="status"]')).toContainText(`Missed by ${distance} ${units}. 0 points.`);
    const gap = page.locator('.ruler-gap');
    await expect(gap).toBeVisible();
    const geometry = await gap.evaluate((element) => ({
      left: Number.parseFloat(element.style.left),
      width: Number.parseFloat(element.style.width),
    }));
    expect(geometry.left).toBeCloseTo((start - 40) / 42 * 100, 3);
    expect(geometry.width).toBeCloseTo(distance / 42 * 100, 3);
    await expect(page.locator('.round-total .tabular')).toHaveText('0');
  });
}

test('a zero-point catch keeps its hit state and shows no miss gap or celebration', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAt(page, DAY1);
  await typeWindow(page, 40, 81);
  await lockAndSettle(page);

  await expect(page.locator('.outcome-hit')).toContainText('Inside, but too wide to score.');
  await expect(page.locator('.outcome-points')).toHaveText('+0');
  await expect(page.locator('.ruler[data-state="hit"][data-zero]')).toBeVisible();
  await expect(page.locator('.ruler-gap, [data-perfect-window]')).toHaveCount(0);
  await expect(page.locator('.ledger-cell[data-status="zero"]')).toBeVisible();
});
