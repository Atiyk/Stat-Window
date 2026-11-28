import { expect, test, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { collectErrors } from './helpers';

test('verification files are served unchanged and sitemap lists public pages', async ({ request }) => {
  for (const name of ['google557b38af0966bb0e.html', 'BingSiteAuth.xml']) {
    const res = await request.get('/' + name);
    expect(res.status()).toBe(200);
    expect(await res.body()).toEqual(readFileSync(new URL('../public/' + name, import.meta.url)));
  }
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  for (const slug of ['how-to-play','embed','media']) {
    expect(await sitemap.text()).toContain('https://www.statwindow.app/' + slug + '.html');
  }
});

test('public pages are readable, linked and fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const slug of ['how-to-play','embed','media']) {
    const res = await page.goto('/' + slug + '.html');
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://www.statwindow.app/' + slug + '.html');
    await expect(page.getByRole('navigation').getByRole('link', {name:'Play', exact:true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  }
  await page.goto('/embed.html');
  const code = await page.getByLabel('HTML iframe').inputValue();
  expect(code).toContain('https://www.statwindow.app/?utm_source=embed&amp;');
  expect(code).toContain('title="Stat Window');
});

test('every approved media asset is available to preview or download', async ({ request, page }) => {
  const response = await request.get('/media/manifest.json');
  expect(response.ok()).toBe(true);
  const { assets } = await response.json() as { assets: {
    url: string;
    previewUrl?: string;
    type: string;
    kind: string;
    bytes: number;
    width: number;
    height: number;
    alt: string;
    source: string;
    spoilerSafe: boolean;
    reviewStatus: string;
    demonstration?: boolean;
  }[] };
  expect(assets.map(asset => asset.kind)).toEqual(expect.arrayContaining(['brand', 'screenshot', 'video', 'scorecard']));
  await page.goto('/media.html');
  const videos = page.locator('video[controls][preload="none"]');
  await expect(videos).toHaveCount(2);
  for (const asset of assets) {
    const u = new URL(asset.url);
    expect(u.origin).toBe('https://www.statwindow.app');
    expect(asset.spoilerSafe).toBe(true);
    expect(asset.reviewStatus).toBe('approved');
    expect(asset.source).toBeTruthy();
    expect(asset.alt).toBeTruthy();
    expect(asset.width).toBeGreaterThan(0);
    expect(asset.height).toBeGreaterThan(0);
    const download = await request.get(u.pathname);
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toContain(asset.type);
    expect(await download.body()).toHaveLength(asset.bytes);
    await expect(page.locator(`a[download][href="${u.pathname}"]`)).toHaveCount(1);
    if (asset.kind === 'brand') continue;
    expect(asset.demonstration).toBe(true);
    const preview = new URL(asset.previewUrl!);
    expect(preview.origin).toBe(u.origin);
    const previewResponse = await request.get(preview.pathname);
    expect(previewResponse.headers()['content-type']).toContain('image/webp');
    expect((await previewResponse.body()).length).toBeLessThan(asset.bytes);
    if (asset.kind === 'video') {
      const clip = page.locator(`video[poster="${preview.pathname}"]:has(source[src="${u.pathname}"])`);
      await expect(clip).toHaveCount(1);
      const displaySize = await clip.evaluate(async element => {
        const video = element as HTMLVideoElement;
        if (!video.canPlayType('video/mp4; codecs="avc1.640028"')) return null;
        await new Promise<void>((resolve, reject) => {
          video.addEventListener('loadedmetadata', () => resolve(), { once: true });
          video.addEventListener('error', () => reject(new Error('Media clip could not load')), { once: true });
          video.preload = 'metadata';
          video.load();
        });
        return [video.videoWidth, video.videoHeight];
      });
      if (displaySize) expect(displaySize).toEqual([asset.width, asset.height]);
    } else {
      await expect(page.locator(`img[loading="lazy"][src="${preview.pathname}"]`)).toHaveAttribute('alt', asset.alt);
    }
  }
});


test('contact categories and visible address work with narrow layout and keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/contact.html');
  await expect(page.getByRole('heading', { name: 'Contact Stat Window' })).toBeVisible();
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://www.statwindow.app/contact.html');
  const address = page.getByRole('link', { name: 'stat.window.game@gmail.com' });
  await expect(address).toHaveAttribute('href', 'mailto:stat.window.game@gmail.com');
  await address.focus();
  for (const category of ['General feedback', 'Technical issue', 'Question or scoring issue', 'Media or partnership inquiry', 'Embedding support']) {
    await page.keyboard.press('Tab');
    const link = page.getByRole('link', { name: category, exact: true });
    await expect(link).toBeFocused();
    const href = new URL((await link.getAttribute('href'))!);
    expect(href.protocol).toBe('mailto:');
    expect(href.pathname).toBe('stat.window.game@gmail.com');
    expect([...href.searchParams.entries()]).toEqual([['subject', `Stat Window — ${category}`]]);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('publisher configures both dimensions and can copy without clipboard permission', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('Clipboard denied', 'NotAllowedError')) } });
  });
  await page.goto('/embed.html');
  const code = page.getByLabel('HTML iframe');
  const height = page.getByLabel('Frame height (px)');
  const width = page.getByLabel('Maximum width (px)');
  const copy = page.getByRole('button', { name: 'Copy embed code' });
  await height.fill('1000');
  await width.fill('700');
  const valid = await code.inputValue();
  expect(valid).toContain('height="1000"');
  expect(valid).toContain('width="100%"');
  expect(valid).toContain('max-width:700px');
  expect(valid).toContain('Play Stat Window in a new tab');
  await page.getByText('Preview frame', { exact: true }).click();
  await page.getByRole('radio', { name: 'Phone' }).check();
  await expect(page.locator('#embed-preview')).toHaveAttribute('data-width', 'mobile');
  await expect(page.locator('iframe')).toHaveCount(0);
  await width.fill('200');
  await expect(width).toHaveAttribute('aria-invalid', 'true');
  await expect(copy).toBeDisabled();
  await expect(code).toHaveValue(valid);
  await height.fill('10');
  await expect(height).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(height).toHaveValue('850');
  await expect(width).toHaveValue('');
  expect(await code.inputValue()).not.toContain('max-width:');
  await copy.click();
  await expect(code).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Code selected. Copy it using your browser or keyboard.');
  expect(await code.evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart)).toBe((await code.inputValue()).length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('players finish the generated embed across origins and can share and report afterward', async ({ page, baseURL, isMobile }) => {
  // Rewrite only the fixed production origin to the isolated local build.
  const app = new URL(baseURL!);
  test.skip(!['localhost', '127.0.0.1'].includes(app.hostname), 'local isolated preview only');
  const errors = collectErrors(page);
  const restrictedStorage = isMobile;
  await page.addInitScript((blockStorage) => {
    if (window === window.top) return;
    if (blockStorage) {
      for (const key of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, key, { get() { throw new DOMException('Storage denied', 'SecurityError'); } });
      }
    }
    Object.defineProperty(navigator, 'share', { value: undefined });
    Object.defineProperty(navigator, 'clipboard', { value: undefined });
  }, restrictedStorage);
  await page.clock.setFixedTime(new Date('2026-11-28T15:00:00Z'));
  await page.goto('/embed.html');
  await page.getByLabel('Frame height (px)').fill('600');
  await page.getByLabel('Maximum width (px)').fill('720');
  const code = (await page.getByLabel('HTML iframe').inputValue()).replaceAll('https://www.statwindow.app', app.origin);
  const publisher = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Publisher test fixture</title><body>${code}</body></html>`);
  }).listen(0, '127.0.0.1');
  try {
    await once(publisher, 'listening');
    const address = publisher.address();
    if (!address || typeof address === 'string') throw new Error('Publisher fixture did not bind a port');
    await page.goto(`http://127.0.0.1:${address.port}`);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('button', { name: /Play Game/ })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('iframe')).toHaveAttribute('height', '600');
    const size = await page.locator('iframe').boundingBox();
    expect(size!.width).toBeLessThanOrEqual(Math.min(720, (await page.viewportSize())!.width));
    const newTab = page.getByRole('link', { name: 'Play Stat Window in a new tab' });
    await expect(newTab).toHaveAttribute('target', '_blank');
    expect(new URL((await newTab.getAttribute('href'))!).origin).toBe(app.origin);
    const activate = (target: Locator) => isMobile ? target.tap() : target.click();
    await activate(frame.getByRole('button', { name: /Play Game/ }));

    if (restrictedStorage) await expect(frame.getByRole('note')).toContainText('This browser isn’t saving progress');
    for (let round = 1; round <= 5; round++) {
      await expect(frame.locator('.round-label')).toContainText(`${round} of 5`);
      await expect(frame.getByRole('link', { name: /Report question|Give feedback|Contact/ })).toHaveCount(0);
      const low = frame.getByRole('slider', { name: 'Low end of your window' });
      const startingPoint = await low.getAttribute('aria-valuenow');
      await low.press('ArrowRight');
      await expect(low).not.toHaveAttribute('aria-valuenow', startingPoint!);
      await activate(frame.getByRole('button', { name: 'Lock the window' }));
      await expect(frame.locator('.story')).toBeVisible();
      await activate(frame.getByRole('button', { name: /Next question|See your day/ }));
    }
    await expect(frame.locator('.results-title')).toBeVisible();
    await frame.getByRole('button', { name: 'Challenge a friend' }).click();
    const fallback = frame.getByRole('textbox', { name: 'Your result to copy' });
    await expect(fallback).toBeFocused();
    await expect(fallback).toHaveValue(/statwindow\.app\/\?day=2026-11-28/);
    await frame.getByText('Your answers', { exact: true }).click();
    await expect(frame.getByText('Reports open an email with the game date, question number and public question ID.')).toHaveCount(1);
    for (let round = 1; round <= 5; round++) {
      const href = new URL((await frame.getByRole('link', { name: `Report question ${round}` }).getAttribute('href'))!);
      expect(href.pathname).toBe('stat.window.game@gmail.com');
      expect([...href.searchParams.keys()]).toEqual(['subject', 'body']);
      expect(href.searchParams.get('body')).toMatch(new RegExp(`^Puzzle date: 2026-11-28\\nQuestion: ${round}\\nQuestion ID: [\\w-]+\\n\\nDescribe the issue`));
    }
    const feedback = frame.getByRole('link', { name: 'Give feedback' });
    await expect(feedback).toHaveAttribute('href', '/contact.html#feedback');
    await feedback.scrollIntoViewIfNeeded();
    expect(await feedback.evaluate((element) => element.ownerDocument.scrollingElement!.scrollTop)).toBeGreaterThan(0);
    await page.reload();
    if (restrictedStorage) await expect(frame.getByRole('button', { name: /Play Game/ })).toBeVisible();
    else await expect(frame.locator('.results-title')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    publisher.close();
  }
});

test('home metadata and sitemap identify the real branded website', async ({request})=>{
  const home=await request.get('/');
  const html=await home.text();
  const matches=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(matches).toHaveLength(1);
  expect(JSON.parse(matches[0]![1]!)).toEqual({'@context':'https://schema.org','@type':'WebSite',name:'Stat Window',url:'https://www.statwindow.app/'});
  const sitemap=await request.get('/sitemap.xml');
  expect(await sitemap.text()).toContain('https://www.statwindow.app/contact.html');
});
