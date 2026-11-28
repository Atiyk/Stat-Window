// Local-only, review-first capture of the actual untimed walkthrough.
// Run with a local Vite preview at http://127.0.0.1:4173 (or MEDIA_PORT).
// Output is NOT public: manually inspect, approve and update the manifest before publishing.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const port = Number(process.env.MEDIA_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local preview port');
const origin = 'http://127.0.0.1:' + port;
const out = new URL('../../build/media-review/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2, reducedMotion:'reduce' });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date('2026-11-27T15:00:00Z'));
  await page.goto(origin + '/?qa=1');
  await page.getByRole('button',{name:'Try a practice question first'}).click();
  const practice = page.locator('.onboarding-play');
  // Fail closed if the example changes; never capture an official daily question.
  await practice.getByRole('heading',{name:'How many regular-season games did the 2015–16 Golden State Warriors win?'}).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await practice.screenshot({path:new URL('tutorial-question.png',out).pathname});
  console.log('Captured the untimed tutorial for review, not publication.');
} finally { await browser.close(); }
