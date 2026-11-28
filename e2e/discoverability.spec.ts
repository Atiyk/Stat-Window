import { expect, test } from '@playwright/test';

const publicOrigin = 'https://www.statwindow.app';
const publicPages = ['/how-to-play.html', '/embed.html', '/media.html', '/contact.html'];

test.use({ javaScriptEnabled: false });

test('search and social crawlers see the canonical, spoiler-free public pages', async ({ page, request }) => {
  const challengePath = '/?day=2026-11-28&vs=325&utm_source=email';
  await page.goto(challengePath);
  await expect(page).toHaveTitle(/Daily NBA trivia and stats game/);
  await expect(page.getByRole('heading', { name: 'Stat Window' })).toBeVisible();
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `${publicOrigin}/`);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${publicOrigin}/`);

  const description = await page.locator('meta[name=description]').getAttribute('content');
  expect(description).toContain('Five NBA stats, three formats, every day');
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', description!);
  await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute('content', description!);

  const navigation = page.getByRole('navigation', { name: 'About Stat Window' });
  for (const path of publicPages) {
    await expect(navigation.locator(`a[href="${path}"]`)).toBeVisible();
  }

  const socialImage = await request.get('/og.png');
  expect(socialImage.headers()['content-type']).toBe('image/png');
  const png = await socialImage.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);

  const robots = await request.get('/robots.txt');
  expect(await robots.text()).toContain(`Sitemap: ${publicOrigin}/sitemap.xml`);
  const sitemap = await request.get('/sitemap.xml');
  const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(urls).toEqual(expect.arrayContaining(['/', ...publicPages].map((path) => publicOrigin + path)));
  expect(urls.every((url) => url?.startsWith(`${publicOrigin}/`) && !url.includes('?'))).toBe(true);

  for (const path of publicPages) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', publicOrigin + path);
    await expect(page.locator('meta[name=description]')).toHaveAttribute('content', /\S.+/);
  }
});
