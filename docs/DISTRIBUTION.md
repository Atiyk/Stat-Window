# Distribution surfaces

- Search ownership files: `/google557b38af0966bb0e.html` and `/BingSiteAuth.xml`. Keep exact bytes and case. Once production serves them, the owner must finish verification in Google Search Console and Bing Webmaster Tools, then submit `https://www.statwindow.app/sitemap.xml`. Adding files does not itself verify or index the site.
- Public, crawlable `/how-to-play.html`, `/embed.html`, `/media.html`; all canonical URLs in sitemap.
- Media manifest: `/media/manifest.json`. Initial library uses real existing brand assets, not fabricated gameplay. Add new screenshots only from the untimed tutorial or independently reviewed non-official demonstrations. Record source, dimensions, capture date and approval; never capture official or future slate content for publicity. Keep assets static, no new services.
- Embed: copy the HTML on the page, test in a separate-origin host on desktop and mobile, including storage restrictions and new-tab fallback. No guarantee of cross-site native sharing.
- Referral measurement: see MEASUREMENT.md. Use recognized source tags. No paid analytics or added dependencies.

## Release checks
Run repository gates and independent review at the integrated SHA. Verify both root token files return exact bytes and HTTP 200 on branded production, crawlable pages/links and assets work, mobile widths and focus, embed on a separate origin, analytics receipt and privacy opt-out. Do not change launch date or official content. Do not publish before required release gates pass.
