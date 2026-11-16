// Renders public/og.png from scripts/og/og.html (no answers, no dates, so it never spoils a puzzle).
//   node scripts/og/render.cjs
const { chromium } = require('playwright');
const { join } = require('node:path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p.goto('file://' + join(__dirname, 'og.html'));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: join(__dirname, '..', '..', 'public', 'og.png') });
  await b.close();
})();
