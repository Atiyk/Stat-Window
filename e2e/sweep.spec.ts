import { expect, test, type Locator, type Page } from '@playwright/test';
import { lockAndSettle, next, openAt, typeWindow } from './helpers';

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

test.describe('BUG-03: a window worth 0 is honest before and after the lock', () => {
  for (const returning of [false, true]) {
    test(`26 to 100 warns it scores 0, and the reveal says why (${returning ? 'returning' : 'first-time'} player)`, async ({ page }) => {
      await openAt(page, NOV21);
      if (returning) {
        // Finish the first-time hint the normal way, then reload as a returning player.
        await page.getByRole('slider', { name: 'Low end of your window' }).focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowLeft');
        await page.reload();
        await expect(page.locator('.question')).toBeVisible();
        await expect(page.locator('.verdict-line')).toHaveText('Pull the brackets in to start scoring.');
      }
      await typeWindow(page, 26, 100);
      const lock = page.getByRole('button', { name: 'Lock the window' });
      await expect(lock).toBeEnabled();
      await expect(page.locator('.verdict-line')).toContainText('Worth 0 even if it’s inside');
      await expect(page.locator('.verdict-line')).not.toContainText('Drag a bracket in');
      await expect(page.locator('.verdict-line')).not.toContainText('to start scoring');
      await page.screenshot({ path: `${shots}/bug03-prelock-${returning ? 'returning' : 'first'}.png` });
      await lock.click();
      await expect(page.locator('.story')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.outcome-hit')).toContainText('too wide to score');
      await expect(page.locator('.outcome-points')).toHaveText('+0');
      await page.screenshot({ path: `${shots}/bug03-reveal-${returning ? 'returning' : 'first'}.png` });
    });
  }

  test('Help explains that a nearly whole ruler also scores 0', async ({ page }) => {
    await openAt(page, NOV21);
    await page.getByRole('button', { name: 'How to play' }).click();
    await expect(page.getByRole('dialog', { name: 'How it works' })).toContainText(/nearly the whole ruler.*scores? 0/i);
  });
});
