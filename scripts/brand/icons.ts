/**
 * Writes every brand asset from the canonical symbol (src/brand/symbol.ts):
 *   public/brand/symbol.svg        navy court, copper ball, transparent (light backgrounds)
 *   public/brand/symbol-cream.svg  cream court, copper ball, transparent (navy backgrounds)
 *   public/brand/symbol-mono.svg   one colour (currentColor), for single-ink uses
 *   public/favicon.svg             the symbol on a navy tile, legible on light and dark tabs
 *   public/icons/court-{180,192,512}.png and court-maskable-512.png, rasterised from the SVGs
 *
 *   node --experimental-strip-types scripts/brand/icons.ts [--check]
 * --check only verifies the SVGs are current (rasters need a browser; CI checks their sizes).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_SVGS } from '../../src/brand/assets.ts';
import { GARDEN, symbolSvg } from '../../src/brand/symbol.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const pub = (p: string) => join(ROOT, 'public', p);


/** Raster icons: name, size, SVG. Apple and maskable icons are full-bleed; the OS applies its own shape. */
const RASTERS: [string, number, string][] = [
  ['icons/court-180.png', 180, symbolSvg({ line: GARDEN.cream, ball: GARDEN.copper, tile: GARDEN.navy, tileRadius: 0 }, 0.78)],
  ['icons/court-192.png', 192, symbolSvg({ line: GARDEN.cream, ball: GARDEN.copper, tile: GARDEN.navy, tileRadius: 14 }, 0.82)],
  ['icons/court-512.png', 512, symbolSvg({ line: GARDEN.cream, ball: GARDEN.copper, tile: GARDEN.navy, tileRadius: 14 }, 0.82)],
  // Maskable: everything inside the central 80% safe zone.
  ['icons/court-maskable-512.png', 512, symbolSvg({ line: GARDEN.cream, ball: GARDEN.copper, tile: GARDEN.navy, tileRadius: 0 }, 0.62)],
];

async function main() {
  const check = process.argv.includes('--check');
  const stale = Object.entries(BRAND_SVGS).filter(([p, svg]) => {
    try { return readFileSync(pub(p), 'utf8') !== svg; } catch { return true; }
  });
  if (check) {
    if (stale.length) {
      console.error(`Brand SVGs out of date: ${stale.map(([p]) => p).join(', ')}. Run: npm run brand:icons`);
      process.exit(1);
    }
    console.log('Brand SVGs are up to date.');
    return;
  }
  mkdirSync(pub('brand'), { recursive: true });
  mkdirSync(pub('icons'), { recursive: true });
  for (const [p, svg] of Object.entries(BRAND_SVGS)) writeFileSync(pub(p), svg);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [p, size, svg] of RASTERS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body>`);
    await page.locator('img').screenshot({ path: pub(p), omitBackground: true });
  }
  await browser.close();
  console.log(`Wrote ${Object.keys(BRAND_SVGS).length} SVGs and ${RASTERS.length} PNGs.`);
}
await main();
