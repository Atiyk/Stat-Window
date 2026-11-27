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

// The bars must be tall enough to compare (42, 48 and 47 must not look identical), and the
// Lock must still be on the first screen with both handles. Value labels never overlap.
// The format instruction is onboarding guidance and stays visible on short phones too
// (390×664 is the iPhone 13 class the webkit-mobile project uses).
const MIN_PLOT = 88;
for (const size of [{ width: 320, height: 568 }, { width: 390, height: 664 }, { width: 390, height: 844 }]) {
  test(`chart question at ${size.width}×${size.height}: plot is at least ${MIN_PLOT}px tall, labels apart, Lock in view`, async ({ page }) => {
    await page.setViewportSize(size);
    await openAt(page, CHART_DAY);
    const plot = (await page.locator('.q-chart__plot').first().boundingBox())!;
    expect(plot.height).toBeGreaterThanOrEqual(MIN_PLOT);
    await expect(page.locator('.round .format-cue__line')).toBeVisible();
    await expect(page.getByRole('button', { name: /Lock the window|Pull the brackets in first/ })).toBeInViewport({ ratio: 1 });
    // The visible grips, not just their hit areas, start clear of the sticky bar (background included).
    const bar = (await page.locator('.action-bar').boundingBox())!;
    for (const grip of await page.locator('.bracket-grip').all()) {
      const g = (await grip.boundingBox())!;
      expect(g.y + g.height, 'grip clear of the Lock bar').toBeLessThanOrEqual(bar.y);
    }
    const boxes = await page.locator('.q-chart__value').evaluateAll((els) => els.map((e) => {
      const range = document.createRange();
      range.selectNodeContents(e);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, text: e.textContent };
    }));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.left, `${boxes[i - 1]!.text} / ${boxes[i]!.text}`).toBeGreaterThan(boxes[i - 1]!.right + 2);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
}

// Short landscape: the left column has the room below the chart, so the plot uses it (it was
// 44px). The whole chart, labels included, stays on the first screen beside Lock and both grips.
const MIN_LANDSCAPE_PLOT = 64;
for (const day of [CHART_DAY, new Date('2026-12-03T15:00:00Z')]) {
  test(`short landscape 844×390 (${day.toISOString().slice(0, 10)}): plot is at least ${MIN_LANDSCAPE_PLOT}px, chart and Lock on the first screen`, async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openAt(page, day);
    const plot = (await page.locator('.q-chart__plot').first().boundingBox())!;
    expect(plot.height).toBeGreaterThanOrEqual(MIN_LANDSCAPE_PLOT);
    await expect(page.locator('.q-chart')).toBeInViewport({ ratio: 1 });
    for (const target of [lowBracket(page), highBracket(page), page.getByRole('button', { name: /Lock the window|Pull the brackets in first/ })]) {
      await expect(target).toBeInViewport({ ratio: 1 });
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
}
