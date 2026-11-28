import { legacyImportLink } from '../lib/save-transfer';

/** Secondary public links, never rendered inside a timed round. */
export function SiteLinks() {
  const importLink = legacyImportLink();
  return (
    <nav className="site-links" aria-label="About Stat Window">
      <a href="/how-to-play.html">Game guide</a>
      <a href="/media.html">Media</a>
      <a href="/embed.html">Embed</a>
      <a href="/contact.html">Contact</a>
      <a href="/privacy.html">Privacy</a>
      <a href="/credits.html">Credits</a>
      {importLink && <a href={importLink}>Import Vercel saves</a>}
    </nav>
  );
}
