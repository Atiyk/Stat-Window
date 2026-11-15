import { expect, test, type Page } from '@playwright/test';
import { DAY1, next, openAt, typeWindow } from './helpers';

// Design study: the same build under four palettes. Run with STUDY=1; skipped otherwise.
const THEMES: Record<string, Record<string, string>> = {
  'a-clubhouse': {},
  'b-sea-glass': {
    paper: '#eef3f2', surface: '#fbfdfd', 'paper-2': '#e3ebea', line: '#d2dedd', ink: '#15303a', 'ink-soft': '#52666d',
    brand: '#1f5d6c', 'brand-press': '#174956', 'brand-soft': '#ddebea', band: '#c9dfdf', accent: '#d98a5f', 'accent-text': '#a3532b', tick: '#9db0b2',
  },
  'c-scorecard': {
    paper: '#f5f3ec', surface: '#fffefa', 'paper-2': '#ece9e0', line: '#dcdddf', ink: '#1b2333', 'ink-soft': '#5a6273',
    brand: '#2c4a7a', 'brand-press': '#213a61', 'brand-soft': '#e4eaf4', band: '#cfdbee', accent: '#d0603f', 'accent-text': '#a8442a', tick: '#a6adba',
  },
  'd-clay-court': {
    paper: '#f6f0e8', surface: '#fffbf6', 'paper-2': '#efe6db', line: '#e4d9cd', ink: '#2d2420', 'ink-soft': '#6a5d55',
    brand: '#8f4429', 'brand-press': '#74361f', 'brand-soft': '#f4e3d8', band: '#ebd3c3', accent: '#2e6f8e', 'accent-text': '#255b75', tick: '#b9a99c',
  },
};
const out = 'test-results/study';

async function theme(page: Page, vars: Record<string, string>) {
  const css = Object.entries(vars).map(([k, v]) => `--${k}:${v};`).join('');
  if (css) await page.addStyleTag({ content: `:root{${css}}` });
}

test.describe('design study', () => {
  test.skip(({ isMobile }) => !process.env.STUDY || isMobile, 'manual design study');
  for (const [name, vars] of Object.entries(THEMES)) {
    test(name, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 375, height: 760 });
      await openAt(page, DAY1);
      await theme(page, vars);
      await typeWindow(page, 66, 78);
      await page.locator('.question').click();
      await page.screenshot({ path: `${out}/${name}-1-phone-adjust.png` });
      await page.getByRole('button', { name: 'Lock the window' }).click();
      await expect(page.locator('.story')).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${name}-2-phone-hit.png` });
      await next(page);
      await typeWindow(page, 10, 16);
      await page.getByRole('button', { name: 'Lock the window' }).click();
      await expect(page.locator('.story')).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${name}-3-phone-miss.png` });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/${name}-4-desktop-miss.png` });
    });
  }
});
