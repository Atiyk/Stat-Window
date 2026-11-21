import { expect, test, type Locator, type Page } from '@playwright/test';
import { lockAndSettle, next, openAt } from './helpers';

/** 2026-11-21 (No. 7 of the beta): Q1 is 25–100, answer 73. */
const NOV21 = new Date('2026-11-21T15:00:00Z');
const shots = process.env.SWEEP_SHOTS ?? 'test-results/screens/sweep';

async function playFive(page: Page, beforeLast?: () => Promise<void>) {
  for (let i = 0; i < 5; i++) {
    await lockAndSettle(page);
    if (i === 4 && beforeLast) await beforeLast();
    await next(page);
  }
}

/** True when `el` is fully on screen and nothing docked (the sticky action bar) covers it. */
async function clearOfDock(page: Page, el: Locator) {
  const box = (await el.boundingBox())!;
  const bar = (await page.locator('.action-bar').boundingBox())!;
  const vh = page.viewportSize()!.height;
  return { top: box.y, bottom: box.y + box.height, barTop: bar.y, ok: box.y >= 0 && box.y + box.height <= Math.min(vh, bar.y) + 0.5 };
}

test.describe('BUG-01: 320x568 first screen and reveal', () => {
  test('ruler, hint, verdict and points clear the docked button', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openAt(page, NOV21);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/bug01-320-first.png` });
    expect(await clearOfDock(page, page.locator('.ruler-track'))).toMatchObject({ ok: true });
    expect(await clearOfDock(page, page.locator('.verdict-line p'))).toMatchObject({ ok: true });
    await expect(page.getByRole('button', { name: 'Pull the brackets in first' })).toBeInViewport({ ratio: 1 });
    await lockAndSettle(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${shots}/bug01-320-reveal.png` });
    expect(await clearOfDock(page, page.locator('.verdict-line .outcome'))).toMatchObject({ ok: true });
    expect(await clearOfDock(page, page.locator('.ruler-track'))).toMatchObject({ ok: true });
    await expect(page.getByRole('button', { name: 'Next question' })).toBeInViewport({ ratio: 1 });
  });
});

test.describe('BUG-02: results open at the top', () => {
  test('at 320x568 the results start at scrollY 0 with the visible heading focused', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openAt(page, NOV21);
    await playFive(page, () => page.mouse.wheel(0, 400));
    await expect(page.locator('.results-title')).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${shots}/bug02-320-results.png` });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator('.results-title')).toBeFocused();
    await expect(page.locator('.results-title')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.results-score')).toBeInViewport({ ratio: 1 });
  });
});

test.describe('BUG-08: 200% text on the results page', () => {
  for (const width of [390, 320]) {
    test(`no sideways scroll on results at ${width} with 200% text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await openAt(page, NOV21);
      await page.addStyleTag({ content: 'html{font-size:200%}' });
      await playFive(page);
      await expect(page.locator('.results-score')).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shots}/bug08-${width}-results.png`, fullPage: true });
      const over = await page.evaluate(() => {
        const vw = window.innerWidth;
        return [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > vw + 1).map((e) => e.className).slice(0, 8);
      });
      expect(over).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
  }
});
