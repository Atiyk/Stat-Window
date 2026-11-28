# Distribution surfaces

- Search ownership files: `/google557b38af0966bb0e.html` and `/BingSiteAuth.xml`. Keep exact bytes and case. Once production serves them, the owner must finish verification in Google Search Console and Bing Webmaster Tools, then submit `https://www.statwindow.app/sitemap.xml`. Adding files does not itself verify or index the site.
- Public, crawlable `/how-to-play.html`, `/embed.html`, `/media.html`; all canonical URLs in sitemap.
- Media manifest: `/media/manifest.json`. Initial library uses real existing brand assets, not fabricated gameplay. Add new screenshots only from the untimed tutorial or independently reviewed non-official demonstrations. Record source, dimensions, capture date and approval; never capture official or future slate content for publicity. Keep assets static, no new services.
- Embed: copy the HTML on the page, test in a separate-origin host on desktop and mobile, including storage restrictions and new-tab fallback. No guarantee of cross-site native sharing.
- Referral measurement: see MEASUREMENT.md. Use recognized source tags. No paid analytics or added dependencies.

## Release checks
Run repository gates and independent review at the integrated SHA. Verify both root token files return exact bytes and HTTP 200 on branded production, crawlable pages/links and assets work, mobile widths and focus, embed on a separate origin, analytics receipt and privacy opt-out. Do not change launch date or official content. Do not publish before required release gates pass.

### Capture a real gameplay asset
With a local preview running, use `node scripts/media/capture.mjs`. The script blocks off-origin requests and captures only the known untimed tutorial question in a fresh browser, to `build/media-review/tutorial-question.png`. Inspect the result for layout, spoilers and privacy before copying to `public/media/` and updating the manifest and page. The initial public library is brand assets only; no screenshot has been generated or approved yet.

### V5.7 staged foundation
Contact uses ordinary email links, never a submission backend. Completed results offer feedback and question reports with only the puzzle date, position and public question ID. The address is visible on the contact page for manual copying. Secondary public links appear on Home and Results, never in timed rounds. The home WebSite JSON-LD describes the real site name and canonical URL. No launch config, verification token, score or analytics change.

Release gate: visually inspect these changes at all required widths and 200% text, test mailto and report links, inspect static JSON-LD and sitemap, check exact-head CI and independent review. The full owner Master UI/UX Design Playbook was not located in the available repository or indexed files; do not claim full compliance. Media captures, physical devices and production analytics are unverified in this staging pass.
