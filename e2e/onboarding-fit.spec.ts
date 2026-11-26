import { expect, test } from '@playwright/test';
import { NBA_FIRST, openWalkthrough } from './helpers';

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
