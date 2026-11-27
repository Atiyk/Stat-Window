import { expect, test } from '@playwright/test';
import { DAY1, highBracket, lockAndSettle, lowBracket, next, openAt, typeWindow } from './helpers';

test('keyboard: arrows step, Shift jumps, brackets cannot cross, Enter locks', async ({ page }) => {
  await openAt(page, DAY1); // scale 40–82, step 1
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '41');
  await expect(lowBracket(page).locator('.bracket-tag')).toHaveText('41');
  await expect(lowBracket(page).locator('.bracket-tag')).toHaveCSS('opacity', '1');
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
  const lowReadout = page.getByRole('button', { name: /^Low end/ });
  await lowReadout.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: /^Low end/ })).toBeFocused();
  await page.keyboard.type('70.6');
  await page.keyboard.press('Enter');
  await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', '71');
  await expect(lowReadout).toBeFocused();
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
  await expect(page.locator('.range-tag')).toHaveText('50–72');
  await page.mouse.up();
  await expect(page.locator('.range-tag')).toHaveCount(0);
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

test('mouse: both ends of a narrow window drag precisely from off-center contact', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse test');
  await page.setViewportSize({ width: 390, height: 844 });
  await openAt(page, DAY1);
  const track = (await page.locator('.ruler-track').boundingBox())!;
  const step = track.width / 42; // Day 1 scale: 40–82.
  const y = track.y + 25;

  for (const which of ['lo', 'hi'] as const) {
    await typeWindow(page, 62, 63);
    const bracket = which === 'lo' ? lowBracket(page) : highBracket(page);
    const box = (await bracket.boundingBox())!;
    const sign = which === 'lo' ? -1 : 1;
    const offCenter = box.x + box.width / 2 + sign * 10;
    await page.mouse.move(offCenter, y);
    await page.mouse.down();
    await page.mouse.move(offCenter + sign * 3 * step, y, { steps: 3 });
    await page.mouse.up();
    await expect(lowBracket(page)).toHaveAttribute('aria-valuenow', which === 'lo' ? '59' : '62');
    await expect(highBracket(page)).toHaveAttribute('aria-valuenow', which === 'hi' ? '66' : '63');
  }
});

test('six-digit scales fit at 320px with 200% text and keep exact editable values', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // 2027-01-10 Q2: All-Star attendance on a 0–150,000 scale (six-digit labels).
  await openAt(page, new Date('2027-01-10T15:00:00Z'));
  await lockAndSettle(page);
  await next(page);
  await expect(page.locator('.question')).toContainText('All-Star Game');
  await page.addStyleTag({ content: 'html { font-size: 200% }' });
  await page.evaluate(() => document.fonts.ready);
  // Push the high bracket to the scale maximum so the readout really has six digits.
  await highBracket(page).focus();
  await page.keyboard.press('End');
  await expect(highBracket(page)).toHaveAttribute('aria-valuenow', '150000');
  const highReadout = page.getByRole('button', { name: /^High end: \d{3},\d{3}/ });
  await expect(highReadout).toBeVisible();
  await expect(highReadout).toContainText('150,000');
  const highValue = (await highReadout.getAttribute('aria-label') ?? (await highReadout.innerText())).match(/\d{3},\d{3}/)![0].replace(/,/g, '');
  expect(highValue).toBe('150000');
  expect(Number(highValue)).toBeGreaterThanOrEqual(100000);
  const labels = await page.locator('.tick-label').evaluateAll((elements) =>
    elements.map((element) => {
      const { left, right } = element.getBoundingClientRect();
      return { left, right };
    }),
  );
  for (let i = 1; i < labels.length; i++) {
    expect(labels[i]!.left).toBeGreaterThanOrEqual(labels[i - 1]!.right - 0.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await highReadout.click();
  const input = page.getByRole('textbox', { name: /^High end/ });
  await expect(input).toHaveValue(highValue);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const typed = String(Number(highValue) - 1000);
  await input.fill(typed);
  await input.press('Enter');
  await expect(highBracket(page)).toHaveAttribute('aria-valuenow', typed);
});

test('progress chips grow with 200% text at 390px, so no number is clipped', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAt(page, new Date('2027-01-10T15:00:00Z'));
  await lockAndSettle(page);
  await next(page);
  await page.addStyleTag({ content: 'html { font-size: 200% }' });
  await page.evaluate(() => document.fonts.ready);
  const cells = page.locator('.round-top .ledger-cell');
  await expect(cells).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    const cell = (await cells.nth(i).boundingBox())!;
    const num = (await cells.nth(i).locator('.ledger-num').boundingBox())!;
    expect(num.x, `chip ${i + 1} left`).toBeGreaterThanOrEqual(cell.x - 0.5);
    expect(num.x + num.width, `chip ${i + 1} right`).toBeLessThanOrEqual(cell.x + cell.width + 0.5);
    expect(num.y, `chip ${i + 1} top`).toBeGreaterThanOrEqual(cell.y - 0.5);
    expect(num.y + num.height, `chip ${i + 1} bottom`).toBeLessThanOrEqual(cell.y + cell.height + 0.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
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
  await expect(lowBracket(page).locator('.bracket-tag')).toHaveCSS('opacity', '1');
  const valueTag = (await lowBracket(page).locator('.bracket-tag').boundingBox())!;
  expect(valueTag.y + valueTag.height).toBeLessThan(grip.y);
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

test('the untouched full scale cannot be locked', async ({ page }) => {
  await openAt(page, DAY1);
  await expect(page.getByRole('button', { name: 'Pull the brackets in first' })).toBeDisabled();
  await lowBracket(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.story')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Lock the window' })).toBeEnabled();
});

test('the reveal can be skipped', async ({ page }) => {
  await openAt(page, DAY1);
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.locator('.story')).toBeVisible({ timeout: 900 });
});

test('reduced motion: the answer appears without the travel', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAt(page, DAY1);
  await lowBracket(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await expect(page.locator('.story')).toBeVisible({ timeout: 400 });
});
