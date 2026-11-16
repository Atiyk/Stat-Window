import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { collectErrors, DAY1, lockAndSettle, next, openAt } from './helpers';

const WIDTHS = [320, 375, 390, 768, 1024, 1440];
const shots = 'test-results/screens';

test.describe('layout', () => {
  test.skip(({ isMobile }) => isMobile, 'viewport sweep runs once, on the desktop project');

  for (const width of WIDTHS) {
    test(`no overflow, reachable controls and clean console at ${width}px`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width, height: width < 700 ? 720 : 900 });
      await openAt(page, DAY1);
      const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(await noOverflow()).toBe(true);
      await expect(page.getByRole('button', { name: 'Pull the brackets in first' })).toBeInViewport();
      await expect(page.locator('.ruler-track')).toBeInViewport({ ratio: 1 });
      for (const handle of await page.getByRole('slider').all()) {
        const box = (await handle.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: `${shots}/${width}-question.png`, fullPage: true });
      await lockAndSettle(page);
      expect(await noOverflow()).toBe(true);
      // The answer flag must never sit on top of the verdict text.
      await page.waitForTimeout(500);
      const flag = (await page.locator('.marker-flag').boundingBox())!;
      const verdict = (await page.locator('.verdict-line p').boundingBox())!;
      expect(flag.y).toBeGreaterThanOrEqual(verdict.y + verdict.height - 1);
      // The next step is on screen after every reveal, without scrolling.
      await expect(page.getByRole('button', { name: 'Next question' })).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `${shots}/${width}-reveal.png`, fullPage: true });
      await page.screenshot({ path: `${shots}/${width}-reveal-fold.png` });
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 600);
        await next(page);
        // A new round opens at the top of the page, brand mark included.
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
        await lockAndSettle(page);
        await expect(page.getByRole('button', { name: i === 3 ? 'See your day' : 'Next question' })).toBeInViewport({ ratio: 1 });
      }
      await next(page);
      await expect(page.locator('.results-score')).toBeVisible();
      expect(await noOverflow()).toBe(true);
      await page.screenshot({ path: `${shots}/${width}-results.png`, fullPage: true });
      await expect(page.getByRole('button', { name: 'Challenge a friend' })).toBeVisible();
      // A friend's challenge link at the same width, in a browser that hasn't played that day.
      await page.evaluate(() => localStorage.clear());
      await openAt(page, new Date('2026-11-16T15:00:00Z'), '/?day=2026-11-15&vs=274');
      expect(await noOverflow()).toBe(true);
      await expect(page.locator('.challenge-note')).toBeInViewport();
      await page.screenshot({ path: `${shots}/${width}-challenge.png` });
      expect(errors).toEqual([]);
    });
  }

  test('axe finds no serious accessibility violations', async ({ page }) => {
    await openAt(page, DAY1);
    const check = async () => {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length}`);
    };
    expect(await check()).toEqual([]);
    await lockAndSettle(page);
    await page.waitForTimeout(800); // let entrance animations finish so contrast is measured at rest
    expect(await check()).toEqual([]);
    await page.getByRole('button', { name: 'How to play' }).click();
    await page.waitForTimeout(400);
    expect(await check()).toEqual([]);
    await page.keyboard.press('Escape');
    // A challenge link in a browser that hasn't played that day, through to results.
    await page.evaluate(() => localStorage.clear());
    await openAt(page, new Date('2026-11-16T15:00:00Z'), '/?day=2026-11-15&vs=274');
    expect(await check()).toEqual([]);
    for (let i = 0; i < 5; i++) {
      await lockAndSettle(page);
      await next(page);
    }
    await expect(page.locator('.versus')).toBeVisible();
    await page.waitForTimeout(800);
    expect(await check()).toEqual([]);
  });

  test('200% text zoom keeps the game usable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await openAt(page, DAY1);
    await page.addStyleTag({ content: 'html{font-size:200%}' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${shots}/375-text-200.png`, fullPage: true });
  });
});
