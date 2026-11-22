import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DAY1, DAY2 } from './helpers';

test('tutorial movement alone never records completion or starts a scored question', async ({ page }) => {
  await page.clock.setFixedTime(DAY1);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Catch the number.' })).toBeFocused();
  await expect(page.locator('.question')).toHaveCount(0);
  const reveal = page.getByRole('button', { name: 'Reveal practice answer' });
  await expect(reveal).toBeDisabled();
  await page.getByRole('slider', { name: 'Practice low end' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(reveal).toBeEnabled();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') || '{}'));
  expect(before.settings.introSeen).toBe(false);
  expect(before.runs['2026-11-15']?.results ?? []).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Catch the number.' })).toBeVisible();
  await expect(page.locator('.question')).toHaveCount(0);
});

test('practice reveal and explicit Start persist introSeen only when complete', async ({ page }) => {
  await page.clock.setFixedTime(DAY1);
  await page.goto('/');
  const low = page.getByRole('slider', { name: 'Practice low end' });
  await expect(low).toBeVisible();
  await low.fill('40');
  await page.getByRole('button', { name: 'Reveal practice answer' }).click();
  await expect(page.getByRole('status')).toContainText('42');
  await expect(page.locator('.question')).toHaveCount(0);
  await page.getByRole('button', { name: "Start today's five" }).click();
  await expect(page.locator('.question')).toBeVisible();
  await expect(page.locator('.question')).toBeFocused();
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') || '{}'));
  expect(save.settings.introSeen).toBe(true);
  await page.clock.setFixedTime(DAY2);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ready for five?' })).toBeVisible();
  await expect(page.locator('.question')).toHaveCount(0);
  await page.getByRole('button', { name: "Start today's five" }).click();
  await expect(page.locator('.question')).toBeVisible();
  await expect(page.locator('.question')).toBeFocused();
});

test('skip is deliberate, saves completion and leaves question hidden until activation', async ({ page }) => {
  await page.clock.setFixedTime(DAY1);
  await page.goto('/');
  const skip = page.getByRole('button', { name: 'Skip tutorial and start' });
  await expect(skip).toBeVisible();
  await expect(page.locator('.question')).toHaveCount(0);
  await skip.click();
  await expect(page.locator('.question')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('stat-window:v1') || '{}').settings.introSeen)).toBe(true);
});

test('an older browser save starts with the ready card rather than a replayed tutorial', async ({ page }) => {
  await page.clock.setFixedTime(DAY1);
  await page.addInitScript(() => localStorage.setItem('stat-window:v1', JSON.stringify({
    version: 1, runs: {}, settings: { sound: false, introSeen: true },
  })));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ready for five?' })).toBeVisible();
  await expect(page.locator('.question')).toHaveCount(0);
  await page.getByRole('button', { name: "Start today's five" }).click();
  await expect(page.locator('.question')).toBeVisible();
  await expect(page.locator('.question')).toBeFocused();
});

test('challenge links retain comparison data after the first-visit tutorial', async ({ page }) => {
  await page.clock.setFixedTime(DAY1);
  await page.goto('/?day=2026-11-15&vs=200');
  await expect(page.locator('.question')).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip tutorial and start' }).click();
  await expect(page.locator('.challenge-note')).toContainText('200');
  await expect(page.locator('.question')).toBeVisible();
});

test('mobile-width tutorial has touch-size controls, keyboard focus and no horizontal overflow', async ({ page }) => {
  await page.clock.setFixedTime(DAY1);
  for (const [width, height] of [[320, 568], [390, 844], [720, 450]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const heading = page.getByRole('heading', { name: 'Catch the number.' });
    await expect(heading).toBeFocused();
    const bounds = await page.getByRole('button', { name: 'Skip tutorial and start' }).boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, 'horizontal overflow at 200% text size').toBe(false);
});

test('first-time tutorial passes automated axe audit', async ({ page }) => {
  await page.clock.setFixedTime(DAY1);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Catch the number.' })).toBeVisible();
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
});
