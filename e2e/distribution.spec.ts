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


test('contact page provides accessible email categories and a canonical URL', async ({ page }) => {
  await page.goto('/contact.html');
  await expect(page.getByRole('heading', { name: 'Contact Stat Window' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Embedding support' })).toHaveAttribute('href', /^mailto:stat\.window\.game@gmail\.com\?subject=/);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://www.statwindow.app/contact.html');
});


test('publisher can configure a responsive frame without loading a live game', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/embed.html');
  const code=page.getByLabel('HTML iframe');
  const height=page.getByLabel('Frame height (px)');
  await height.fill('1000');
  expect(await code.inputValue()).toContain('height="1000"');
  expect(await code.inputValue()).toContain('width="100%"');
  expect(await code.inputValue()).toContain('Play Stat Window in a new tab');
  await page.getByRole('radio',{name:'Phone'}).check();
  await expect(page.locator('#embed-preview')).toHaveAttribute('data-width','mobile');
  await expect(page.locator('iframe')).toHaveCount(0);
  await height.fill('10');
  await expect(height).toHaveAttribute('aria-invalid','true');
  await expect(page.getByRole('button',{name:'Copy embed code'})).toBeDisabled();
  await page.getByRole('button',{name:'Reset'}).click();
  expect(await code.inputValue()).toContain('height="850"');
  await expect(page.getByRole('button',{name:'Copy embed code'})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('generated iframe opens the game from a separate-origin publisher fixture', async ({page,baseURL}) => {
  // Never play or send scores to a production URL. Rewrite only the fixed embed origin to the local test app.
  const app=new URL(baseURL!);
  test.skip(!['localhost','127.0.0.1'].includes(app.hostname),'local isolated preview only');
  await page.clock.setFixedTime(new Date('2026-11-28T15:00:00Z'));
  await page.goto('/embed.html');
  const code=(await page.getByLabel('HTML iframe').inputValue()).replaceAll('https://www.statwindow.app',app.origin);
  const publisher='http://publisher.statwindow.test/';
  await page.route(publisher,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Publisher test fixture</title><body>'+code+'</body></html>'}));
  await page.goto(publisher);
  const frame=page.frameLocator('iframe');
  await expect(frame.getByRole('heading',{name:'How well do you know ball?'})).toBeVisible({timeout:15000});
  await expect(frame.getByRole('button',{name:/Play Game/})).toBeVisible();
  await expect(page.getByRole('link',{name:'Play Stat Window in a new tab'})).toHaveAttribute('target','_blank');
});
