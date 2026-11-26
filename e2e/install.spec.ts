import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { lockAndSettle, NBA_DAYS, NBA_FIRST, next, startDailyIfNeeded } from './helpers';
import { openFold } from './results-helpers';

const installSuggestion = (page: Page) => page.locator('.install-prompt');
const installButton = (page: Page) => page.getByRole('button', { name: 'Install Stat Window' });
const manualButton = (page: Page) => page.getByRole('button', { name: 'Add to Home Screen' });

async function seedResults(page: Page, dates: readonly string[]) {
  const runs = Object.fromEntries(dates.map((day) => {
    const slate = JSON.parse(readFileSync(new URL(`../content/days/${day}.json`, import.meta.url), 'utf8')) as {
      questions: { id: string; min: number; max: number }[];
    };
    return [day, {
      advanced: 5,
      results: slate.questions.map(({ id, min, max }) => ({ questionId: id, lo: min, hi: max, hit: true, points: 0, missBy: 0 })),
    }];
  }));
  await page.addInitScript((savedRuns) => {
    if (!localStorage.getItem('stat-window:v1')) {
      localStorage.setItem('stat-window:v1', JSON.stringify({ version: 1, runs: savedRuns, settings: { introSeen: true, sound: false } }));
    }
  }, runs);
}

async function offerNativeInstall(page: Page) {
  const intercepted = await page.evaluate(() => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => { document.documentElement.dataset.installPromptCalls = String(Number(document.documentElement.dataset.installPromptCalls ?? '0') + 1); },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(intercepted).toBe(true);
}

test('manifest starts at the live daily game with install and Apple icons', async ({ page }) => {
  await page.clock.setFixedTime(NBA_FIRST);
  await page.goto('/');
  const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(manifestHref).toBe('/manifest.webmanifest');
  const appleIcon = page.locator('link[rel=apple-touch-icon]');
  await expect(appleIcon).toHaveAttribute('sizes', '180x180');
  const { manifest, dimensions, workers } = await page.evaluate(async ({ manifestHref, appleIconHref }) => {
    const response = await fetch(manifestHref!);
    if (!response.ok) throw new Error('Manifest did not load');
    const manifest = await response.json() as { icons: { src: string; sizes: string; type: string; purpose: string }[] };
    const dimensions = await Promise.all([...manifest.icons.map((icon) => icon.src), appleIconHref!].map(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }));
    const workers = await navigator.serviceWorker?.getRegistrations();
    return { manifest, dimensions, workers: workers?.length ?? 0 };
  }, { manifestHref, appleIconHref: await appleIcon.getAttribute('href') });
  expect(manifest).toMatchObject({
    id: '/', start_url: '/', scope: '/', display: 'standalone', name: 'Stat Window', short_name: 'Stat Window',
    theme_color: '#F7F4EE', background_color: '#F7F4EE',
    icons: [
      { sizes: '192x192', type: 'image/png', purpose: 'any' },
      { sizes: '512x512', type: 'image/png', purpose: 'any' },
      { sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
  expect(dimensions).toEqual([[192, 192], [512, 512], [512, 512], [180, 180]]);
  expect(workers).toBe(0);
});

test('a native install offer waits for the second official result and stays dismissed', async ({ page }) => {
  await seedResults(page, [NBA_DAYS[0]!]);
  await page.clock.setFixedTime(NBA_FIRST);
  await page.goto('/');
  await expect(page.locator('.results-score')).toBeVisible();
  await offerNativeInstall(page);
  await expect(installSuggestion(page)).toHaveCount(0);

  await page.clock.setFixedTime(new Date(`${NBA_DAYS[1]!}T15:00:00Z`));
  await page.goto('/');
  await startDailyIfNeeded(page);
  await offerNativeInstall(page);
  await expect(page.locator('.question')).toBeVisible();
  await expect(installSuggestion(page)).toHaveCount(0);
  for (let round = 0; round < 5; round++) {
    await lockAndSettle(page);
    await next(page);
  }
  await openFold(page, 'Next puzzle and reminders');
  await expect(installButton(page)).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-install-prompt-calls');
  await installButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-install-prompt-calls', '1');
  await expect(installSuggestion(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Google Calendar/ })).toBeFocused();
  await page.reload();
  await expect(page.locator('.results-score')).toBeVisible();
  await offerNativeInstall(page);
  await expect(installSuggestion(page)).toHaveCount(0);
});

test('iPhone guidance is a dismissible disclosure and stays hidden in standalone', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'Use the iPhone WebKit project for Safari guidance.');
  await seedResults(page, NBA_DAYS.slice(0, 2));
  await page.clock.setFixedTime(new Date(`${NBA_DAYS[1]!}T15:00:00Z`));
  await page.goto('/');
  const guide = page.getByText('In Safari, tap Share', { exact: false });
  await expect(manualButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(guide).toBeHidden();
  await manualButton(page).click();
  await expect(manualButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(guide).toContainText('Add to Home Screen');
  await expect(guide).toContainText('Open as Web App');
  await page.getByRole('button', { name: 'Hide install suggestion' }).click();
  await expect(installSuggestion(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.results-score')).toBeVisible();
  await expect(installSuggestion(page)).toHaveCount(0);

  await page.evaluate(() => localStorage.removeItem('stat-window:install-suggestion-hidden'));
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.reload();
  await expect(page.locator('.results-score')).toBeVisible();
  await expect(installSuggestion(page)).toHaveCount(0);
});
