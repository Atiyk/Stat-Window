import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { collectErrors, DAY1, lockAndSettle, NBA_FIRST, NBA_LAST, NBA_MIDDLE, next, openAt } from './helpers';

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1440];
const MOBILE_HEIGHTS: Partial<Record<number, number>> = { 320: 720, 375: 812, 390: 844, 430: 932 };
/** The original launch day, then the first, middle and last NBA days. */
const DAYS: { name: string; when: Date; widths: number[] }[] = [
  { name: 'launch', when: DAY1, widths: WIDTHS },
  { name: 'nba-first', when: NBA_FIRST, widths: WIDTHS },
  { name: 'nba-middle', when: NBA_MIDDLE, widths: [320, 1024] },
  { name: 'nba-last', when: NBA_LAST, widths: [320, 1440] },
];
const shots = 'test-results/screens';

test.describe('layout', () => {
  test.skip(({ isMobile }) => isMobile, 'viewport sweep runs once, on the desktop project');

  for (const day of DAYS) for (const width of day.widths) {
    const tag = day.name === 'launch' ? `${width}` : `${day.name}-${width}`;
    test(`no overflow, reachable controls and clean console at ${width}px (${day.name})`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width, height: MOBILE_HEIGHTS[width] ?? 900 });
      await openAt(page, day.when);
      const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(await noOverflow()).toBe(true);
      await expect(page.getByRole('button', { name: 'Pull the brackets in first' })).toBeInViewport();
      await expect(page.locator('.ruler-track')).toBeInViewport({ ratio: 1 });
      for (const handle of await page.getByRole('slider').all()) {
        const box = (await handle.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: `${shots}/${tag}-question.png`, fullPage: true });
      await lockAndSettle(page);
      expect(await noOverflow()).toBe(true);
      // The answer flag must never sit on top of the verdict text.
      await page.waitForTimeout(500);
      const flag = (await page.locator('.marker-flag').boundingBox())!;
      const verdict = (await page.locator('.verdict-line p').boundingBox())!;
      expect(flag.y).toBeGreaterThanOrEqual(verdict.y + verdict.height - 1);
      // The next step is on screen after every reveal, without scrolling.
      await expect(page.getByRole('button', { name: 'Next question' })).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `${shots}/${tag}-reveal.png`, fullPage: true });
      // No citation panel or generic fact heading interrupts the reveal.
      await expect(page.locator('.sources, .story-extra-title')).toHaveCount(0);
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
      await page.screenshot({ path: `${shots}/${tag}-results.png`, fullPage: true });
      // Including the percentile line's Refresh (when shown) and the privacy link: no control under 44px tall.
      for (const el of await page.locator('.results button:visible').all()) {
        expect((await el.boundingBox())!.height, (await el.textContent()) ?? '').toBeGreaterThanOrEqual(44);
      }
      await expect(page.getByRole('button', { name: 'Challenge a friend' })).toBeVisible();
      if (day.name === 'launch') {
        // A friend's challenge link at the same width, in a browser that hasn't played that day.
        await page.evaluate(() => localStorage.clear());
        await openAt(page, new Date('2026-11-16T15:00:00Z'), '/?day=2026-11-15&vs=274');
        expect(await noOverflow()).toBe(true);
        await expect(page.locator('.challenge-note')).toBeInViewport();
        await page.screenshot({ path: `${shots}/${tag}-challenge.png` });
      }
      expect(errors).toEqual([]);
    });
  }

  for (const [name, when] of [['launch', DAY1], ['nba-first', NBA_FIRST]] as const)
  test(`axe finds no serious accessibility violations (${name})`, async ({ page }) => {
    await openAt(page, when);
    const check = async () => {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((node) => `${v.id} ${node.target.join(' ')}: ${node.failureSummary}`));
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

  test('tablet shows Next while a long basketball fact remains scrollable', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await openAt(page, NBA_FIRST);
    await lockAndSettle(page);
    const action = page.getByRole('button', { name: 'Next question' });
    await expect(action).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.story-extra-text')).toHaveText(/.{20,}/);
    await page.locator('.story-extra-text').scrollIntoViewIfNeeded();
    await expect(page.locator('.story-extra-text')).toBeInViewport();
    await expect(page.locator('.sources')).toHaveCount(0);
    await expect(action).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('200% text zoom keeps the game usable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await openAt(page, DAY1);
    await page.addStyleTag({ content: 'html{font-size:200%}' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${shots}/375-text-200.png`, fullPage: true });
  });
});
