import { expect, test } from '@playwright/test';
import { highBracket, lowBracket, openAt } from './helpers';

// A missing-point chart must leave both bracket handles on screen, above the sticky Lock
// bar, at round start: the shot clock runs, so a player must never have to scroll to drag.
const CHART_DAY = new Date('2026-12-01T15:00:00Z'); // Q1 is a missing-point chart with a long prompt

// The whole handle, grip included, starts clear of the Lock bar, down to a 320×568 phone.
for (const [size, need] of [[{ width: 390, height: 844 }, 'all'], [{ width: 320, height: 568 }, 'all'], [{ width: 1440, height: 900 }, 'all']] as const) {
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

test('the chart caption does not repeat a unit its title already names', async ({ page }) => {
  await openAt(page, new Date('2026-12-03T15:00:00Z')); // Q1: "Points in one game", unit points
  await expect(page.locator('.q-chart__title')).toHaveText('Points in one game');
  await expect(page.locator('.q-chart__unit')).toHaveCount(0);
});

// Short landscape phones: the clock runs from the first paint, so the slider and Lock must be
// on the first screen beside the prompt and chart, and the home's Play must be too.
for (const size of [{ width: 844, height: 390 }, { width: 932, height: 430 }]) {
  test(`short landscape ${size.width}×${size.height}: chart question keeps both sliders and Lock in view`, async ({ page }) => {
    await page.setViewportSize(size);
    await openAt(page, new Date('2026-12-03T15:00:00Z')); // Q1 is a missing-point chart
    await expect(page.locator('.q-chart')).toBeVisible();
    const lock = page.getByRole('button', { name: /Lock the window|Pull the brackets in first/ });
    for (const target of [lowBracket(page), highBracket(page), lock]) {
      await expect(target).toBeInViewport({ ratio: 1 });
    }
    // The chart sits beside the field, not above it.
    const chart = (await page.locator('.q-chart').boundingBox())!;
    const field = (await page.locator('.field').boundingBox())!;
    expect(field.x).toBeGreaterThanOrEqual(chart.x + chart.width - 1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
  });

  test(`short landscape ${size.width}×${size.height}: home shows Play on the first screen`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.clock.setFixedTime(new Date('2026-12-03T15:00:00Z'));
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Play Game \d+$/ })).toBeInViewport({ ratio: 1 });
  });
}
