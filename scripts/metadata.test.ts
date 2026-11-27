import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://www.statwindow.app';
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = read('index.html');
const meta = (attr: 'name' | 'property', key: string) => html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1];

describe('public metadata (V5.2)', () => {
  it('describes the game as it is: five NBA questions, three formats, free, no account', () => {
    for (const text of [meta('name', 'description'), meta('property', 'og:description'), meta('name', 'twitter:description')]) {
      expect(text).toMatch(/[Ff]ive NBA/);
      expect(text).toMatch(/three/);
      expect(text).toMatch(/[Ff]ree/);
      expect(text).toMatch(/no account/);
    }
    expect(meta('name', 'description')!.length).toBeLessThanOrEqual(160);
  });

  it('has a canonical URL, a large Twitter card and an image that exists', () => {
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/" />`);
    expect(meta('property', 'og:url')).toBe(`${ORIGIN}/`);
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
    expect(meta('name', 'twitter:title')).toBe(meta('property', 'og:title'));
    expect(meta('name', 'twitter:image')).toBe(meta('property', 'og:image'));
    expect(meta('property', 'og:image')).toBe(`${ORIGIN}/og.png`);
    expect(existsSync(new URL('../public/og.png', import.meta.url))).toBe(true);
  });

  it('robots.txt allows crawling and points at a sitemap of real pages', () => {
    const robots = read('public/robots.txt');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).not.toMatch(/^Disallow: \/$/m);
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    const urls = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(urls[0]).toBe(`${ORIGIN}/`);
    for (const u of urls.slice(1)) {
      const page = new URL(u);
      expect(page.origin).toBe(ORIGIN);
      expect(read(`public${page.pathname}`)).toContain(`<link rel="canonical" href="${u}">`);
    }
  });

  it('the manifest names the game and opens on the player’s existing origin', () => {
    const m = JSON.parse(read('public/manifest.webmanifest')) as { description?: string };
    expect(m).toMatchObject({ name: 'Stat Window', id: '/', scope: '/', start_url: '/' });
    expect(m.description).toMatch(/daily NBA/);
  });
});
