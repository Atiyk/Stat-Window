import { expect, type Page } from '@playwright/test';

/** One of the results page's folded sections (V5.2): Your answers, Score card image, Your stats, Practice a past game, Next puzzle and reminders. */
export const resultsFold = (page: Page, title: string) =>
  page.locator('details.results-fold').filter({ has: page.locator('summary', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }) });

/** Opens a folded results section (no-op when it is already open). */
export async function openFold(page: Page, title: string) {
  const fold = resultsFold(page, title);
  if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) await fold.locator('summary').click();
  await expect(fold).toHaveAttribute('open', '');
}
