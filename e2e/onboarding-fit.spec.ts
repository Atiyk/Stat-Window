import { expect, test } from '@playwright/test';
import { NBA_FIRST, lowBracket, openWalkthrough } from './helpers';

// The first-play walkthrough, opened from the new visitor's home: Skip is on its first
// paint, and the Lock action is on screen without scrolling, at every size (V5.1 design review).
// The home itself must show the hook and Play without scrolling.
for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`walkthrough at ${size.width}×${size.height}: Skip and Lock are on the first screen`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.clock.setFixedTime(NBA_FIRST);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'How well do you know ball?' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: /^Play Game \d+$/ })).toBeInViewport({ ratio: 1 });
    await openWalkthrough(page);
    await expect(page.getByRole('button', { name: 'Skip tutorial and start' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: /Lock the window|Pull the brackets in first/ })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `test-results/onboarding-${size.width}.png` });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
}

for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`walkthrough at ${size.width}×${size.height}: the daily stays within reach after the practice answer`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.setFixedTime(NBA_FIRST);
    await page.goto('/');
    await openWalkthrough(page);
    await lowBracket(page).press('PageUp');
    await page.getByRole('button', { name: 'Lock the window' }).click();

    const play = page.getByRole('button', { name: /^Play Game \d+$/ });
    await expect(page.locator('.onboarding-play .reveal-answer')).toBeVisible();
    await expect(play).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('timer')).toHaveCount(0);
    await play.click();
    await expect(page.getByRole('timer')).toHaveText('24s');
  });
}

test('at 200% text, opening and replaying the walkthrough bring its question into view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(NBA_FIRST);
  await page.goto('/');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await openWalkthrough(page);

  const title = page.locator('.onboarding-practice-title');
  await expect(title).toBeFocused();
  await expect(title).toBeInViewport({ ratio: 1 });
  await lowBracket(page).press('PageUp');
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await page.getByRole('button', { name: 'See the three question types' }).focus();
  await page.getByRole('button', { name: 'Try another window' }).click();

  await expect(title).toBeFocused();
  await expect(title).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
