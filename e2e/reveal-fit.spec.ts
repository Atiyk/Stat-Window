import { expect, test, type Page } from '@playwright/test';
import { lockAndSettle, next, openAt } from './helpers';

const CHART_DAY = new Date('2026-12-01T15:00:00Z'); // Q1 is a missing-point chart, Q2 a long text prompt

/** The revealed answer and the ruler's axis labels sit on screen, clear of the sticky Next bar. */
async function expectRevealClear(page: Page) {
  const bar = (await page.locator('.round .action-bar').boundingBox())!;
  const limit = Math.min(bar.y, page.viewportSize()!.height);
  await expect.poll(async () => {
    const answer = (await page.locator('.reveal-answer').boundingBox())!;
    const ruler = (await page.locator('.round .ruler').boundingBox())!;
    return answer.y >= 0 && ruler.y + ruler.height <= limit;
  }, { message: 'answer on screen and ruler axis above the Next bar' }).toBe(true);
  await expect(page.getByRole('button', { name: /Next question|See your day/ })).toBeInViewport({ ratio: 1 });
}

for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`reveal at ${size.width}×${size.height}: answer and ruler axis stay above the Next bar`, async ({ page }) => {
    await page.setViewportSize(size);
    await openAt(page, CHART_DAY);
    await lockAndSettle(page);
    await expectRevealClear(page);
    await next(page);
    await lockAndSettle(page);
    await expectRevealClear(page);
  });
}

// Reduced motion lands the answer at once; the scroll must still measure the settled layout.
test('reveal under reduced motion at 320×568: answer and ruler axis stay above the Next bar', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 568 });
  await openAt(page, CHART_DAY);
  await lockAndSettle(page);
  await expectRevealClear(page);
  await next(page);
  await lockAndSettle(page);
  await expectRevealClear(page);
});

test('short landscape results: the score and Challenge a friend share the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openAt(page, CHART_DAY);
  for (let q = 0; q < 5; q++) { await lockAndSettle(page); await next(page); }
  const challenge = page.getByRole('button', { name: /Challenge a friend/ });
  await expect(challenge).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('.results-total')).toBeInViewport({ ratio: 1 });
  await expect(challenge).toBeInViewport({ ratio: 1 });
});

// A legacy challenge link (total only): the outcome against the friend is the point of the
// screen, so it sits with the score and Challenge, on the first screen in short landscape.
for (const size of [{ width: 844, height: 390 }, { width: 320, height: 568 }]) {
  test(`challenge results at ${size.width}×${size.height}: "Your friend leads by" sits with the score, above Challenge`, async ({ page }) => {
    await page.setViewportSize(size);
    await openAt(page, new Date('2026-11-17T05:05:00Z'), '/?day=2026-11-16&vs=500');
    for (let q = 0; q < 5; q++) { await lockAndSettle(page); await next(page); }
    const challenge = page.getByRole('button', { name: /Challenge a friend/ });
    await expect(challenge).toBeVisible({ timeout: 15_000 });
    const versus = page.locator('.versus');
    await expect(versus).toContainText('Your friend leads by');
    const v = (await versus.boundingBox())!;
    const c = (await challenge.boundingBox())!;
    expect(v.y + v.height, 'outcome line above Challenge').toBeLessThanOrEqual(c.y);
    if (size.height < 500) {
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      for (const target of [versus, page.locator('.results-total'), challenge]) await expect(target).toBeInViewport({ ratio: 1 });
    }
  });
}
