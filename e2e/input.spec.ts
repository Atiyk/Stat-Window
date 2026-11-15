import { expect, test } from '@playwright/test';
import { DAY1, highBracket, lowBracket, openAt } from './helpers';

test('keyboard: arrows step, Shift jumps, brackets cannot cross, Enter locks', async ({ page }) => {
  await openAt(page, DAY1); // scale 40–82, step 1
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '41');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '45');
  await page.keyboard.press('End'); // low End = up to the high end
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '81');
  await expect(highBracket(page)).toHaveAttribute('aria-valuenow', '82');
  await expect(page.locator('.worth b')).toHaveText('100');
  await page.keyboard.press('Enter');
  await expect(page.locator('.outcome-miss')).toBeVisible({ timeout: 5000 });
});

test('numeric entry snaps to the step and clamps to the scale', async ({ page }) => {
  await openAt(page, DAY1);
  await page.getByRole('button', { name: /^High end/ }).click();
  await page.getByRole('textbox', { name: /^High end/ }).fill('500');
  await page.keyboard.press('Enter');
  await expect(highBracket(page)).toHaveAttribute('aria-valuenow', '82');
  await page.getByRole('button', { name: /^Low end/ }).click();
  await page.getByRole('textbox', { name: /^Low end/ }).fill('70.6');
  await page.keyboard.press('Enter');
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '71');
  await page.getByRole('button', { name: /^Low end/ }).click();
  await page.getByRole('textbox', { name: /^Low end/ }).fill('abc');
  await page.keyboard.press('Enter');
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '71');
});

test('mouse: drag a bracket, drag the whole window, tap the track', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse test');
  await openAt(page, DAY1);
  const track = (await page.locator('.ruler-track').boundingBox())!;
  const xFor = (v: number) => track.x + ((v - 40) / 42) * track.width;
  const y = track.y + 30;

  const lo = (await lowBracket(page).boundingBox())!;
  await page.mouse.move(lo.x + lo.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(xFor(60), y, { steps: 6 });
  await page.mouse.up();
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '60');

  // Drag the band: the window keeps its width (60–82, width 22) and moves left.
  await page.mouse.move(xFor(70), y);
  await page.mouse.down();
  await page.mouse.move(xFor(60), y, { steps: 6 });
  await page.mouse.up();
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '50');
  await expect(highBracket(page)).toHaveAttribute('aria-valuenow', '72');

  // Tap open track to the right: the nearer (high) bracket jumps there.
  await page.mouse.click(xFor(78), y);
  await expect(highBracket(page)).toHaveAttribute('aria-valuenow', '78');

  // Dragging the low bracket past the high one stops one step short.
  const lo2 = (await lowBracket(page).boundingBox())!;
  await page.mouse.move(lo2.x + lo2.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(xFor(82), y, { steps: 6 });
  await page.mouse.up();
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '77');
});

test('touch: dragging a bracket moves it and never scrolls the page', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch test');
  await openAt(page, DAY1);
  const cdp = await page.context().newCDPSession(page);
  const grip = (await page.locator('.bracket-lo .bracket-grip').boundingBox())!;
  const track = (await page.locator('.ruler-track').boundingBox())!;
  const startX = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  const endX = track.x + track.width * 0.5;
  const before = await page.evaluate(() => window.scrollY);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
  for (let i = 1; i <= 8; i++) {
    // Diagonal finger motion: vertical drift must not scroll the page.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: startX + ((endX - startX) * i) / 8, y: y - i * 12 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '61');
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test('reduced motion: the answer appears without the travel', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAt(page, DAY1);
  await page.getByRole('button', { name: 'Lock it in' }).click();
  await expect(page.locator('.story')).toBeVisible({ timeout: 400 });
});
