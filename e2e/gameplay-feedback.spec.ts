import { expect, test } from '@playwright/test';
import { DAY1, lockAndSettle, openAt, typeWindow } from './helpers';

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
