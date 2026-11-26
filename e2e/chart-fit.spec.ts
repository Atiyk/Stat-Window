import { expect, test } from '@playwright/test';
import { highBracket, lowBracket, openAt } from './helpers';

// A missing-point chart must leave both bracket handles on screen, above the sticky Lock
// bar, at round start: the shot clock runs, so a player must never have to scroll to drag.
const CHART_DAY = new Date('2026-12-01T15:00:00Z'); // Q1 is a missing-point chart with a long prompt

// On a 320×568 phone at least a full 44px touch target of each handle must be clear;
// everywhere else the whole handle.
for (const [size, need] of [[{ width: 390, height: 844 }, 'all'], [{ width: 320, height: 568 }, 44], [{ width: 1440, height: 900 }, 'all']] as const) {
  test(`chart question at ${size.width}×${size.height}: both handles are visible above the Lock bar`, async ({ page }) => {
    await page.setViewportSize(size);
    await openAt(page, CHART_DAY);
    await expect(page.locator('.q-chart')).toBeVisible();
    const lock = await page.getByRole('button', { name: /Lock the window|Pull the brackets in first/ }).boundingBox();
    for (const handle of [lowBracket(page), highBracket(page)]) {
      const box = (await handle.boundingBox())!;
      expect(box.y, 'handle top on screen').toBeGreaterThanOrEqual(0);
      expect(box.y + (need === 'all' ? box.height : need), 'handle clear of the Lock bar').toBeLessThanOrEqual(lock!.y);
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
}
