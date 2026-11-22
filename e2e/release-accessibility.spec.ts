import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DAY1, NBA_FIRST, lowBracket, openAt } from './helpers';

/**
 * Repeatable stand-ins for manual release checks when a physical device is
 * unavailable. Do NOT describe these as real VoiceOver/TalkBack sessions.
 */
test.describe('release accessibility and viewport smoke', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop project sweeps CSS viewport sizes; WebKit iPhone suite runs separately');

  for (const { name, width, height } of [
    { name: 'small iPhone', width: 320, height: 568 },
    { name: 'narrow mobile', width: 375, height: 720 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'laptop 200 percent zoom equivalent', width: 720, height: 450 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    test(`${name}: reduced-motion, named sliders and visible window controls`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openAt(page, NBA_FIRST);
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(await sideways()).toBe(false);
      const low = lowBracket(page);
      const high = page.getByRole('slider', { name: 'High end of your window' });
      await expect(low).toHaveAttribute('aria-valuenow', /.+/);
      await expect(high).toHaveAttribute('aria-valuenow', /.+/);
      for (const slider of [low, high]) {
        const rect = (await slider.boundingBox())!;
        expect(rect.width, 'ruler touch target width').toBeGreaterThanOrEqual(44);
        expect(rect.height, 'ruler touch target height').toBeGreaterThanOrEqual(44);
      }
      await expect(page.getByRole('button', { name: 'Pull the brackets in first' })).toBeInViewport();
      await expect(page.locator('.ruler-track')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.shot-clock')).toBeVisible();
      expect(await sideways()).toBe(false);
    });
  }

  test('keyboard moves a named slider, Enter locks, and next question receives focus', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAt(page, DAY1);
    const low = lowBracket(page);
    const initial = await low.getAttribute('aria-valuenow');
    await low.focus();
    await expect(low).toBeFocused();
    await page.keyboard.press('ArrowRight');
    expect(await low.getAttribute('aria-valuenow')).not.toBe(initial);
    await page.keyboard.press('Enter');
    await expect(page.locator('.story')).toBeVisible();
    await page.getByRole('button', { name: 'Next question' }).click();
    await expect(page.locator('.round-meta')).toContainText('Question 2 of 5');
    await expect(page.locator('h1.question')).toBeFocused();
  });

  test('390px reduced motion, 200% text: Help and game have no serious axe issues', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAt(page, DAY1);
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const serious = async () => {
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      return audit.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
    };
    expect(await serious()).toEqual([]);
    await page.getByRole('button', { name: 'How to play' }).click();
    await expect(page.getByRole('dialog', { name: 'How it works' })).toBeVisible();
    expect(await serious()).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'How it works' })).not.toBeVisible();
  });
});
