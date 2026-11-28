import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

test('every listed media asset exists and is explicitly spoiler-safe', async ({ request }) => {
  const response = await request.get('/media/manifest.json');
  expect(response.ok()).toBe(true);
  const manifest = await response.json() as { assets: {url:string;spoilerSafe:boolean;kind:string}[] };
  expect(manifest.assets.length).toBeGreaterThan(0);
  for (const asset of manifest.assets) {
    const u = new URL(asset.url);
    expect(u.origin).toBe('https://www.statwindow.app');
    expect(asset.spoilerSafe).toBe(true);
    expect(asset.kind).toBe('brand');
    const res = await request.get(u.pathname);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/^image\//);
  }
});
