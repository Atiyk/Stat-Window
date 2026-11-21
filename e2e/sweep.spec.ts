import { expect, test, type Locator, type Page } from '@playwright/test';
import { lockAndSettle, openAt } from './helpers';

/** 2026-11-21 (No. 7 of the beta): Q1 is 25–100, answer 73. */
const NOV21 = new Date('2026-11-21T15:00:00Z');
const shots = 'test-results/screens/sweep';

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
