import type { Question } from '../content/schema';

const CC_BY_SA = / \(CC BY-SA 4\.0\)$/;
/** Any Wikipedia article is CC BY-SA 4.0, however its source line was written in older day files. */
const WIKIPEDIA = /(^|\.)wikipedia\.org$/;
const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

type Source = { name: string; url: string };

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/^en\.wikipedia\.org$/, 'Wikipedia');
  } catch {
    return 'source';
  }
}

function isWikipedia(url: string): boolean {
  try {
    return WIKIPEDIA.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The credit to show: Wikipedia sources always as "Wikipedia contributors". */
export function creditFor(source: Source): { name: string; licensed: boolean } {
  const wiki = isWikipedia(source.url);
  const licensed = wiki || CC_BY_SA.test(source.name);
  const name = source.name.replace(CC_BY_SA, '').trim();
  return { name: wiki && !/contributors/i.test(name) ? 'Wikipedia contributors' : name, licensed };
}

/** Joins our derivation note as its own sentence, whatever case and punctuation it was written in. */
export function methodSentence(derivation: string): string {
  const t = derivation.trim().replace(/[.\s]+$/, '');
  return t ? `Method: ${t.charAt(0).toUpperCase()}${t.slice(1)}.` : '';
}

/** "Wikipedia contributors" with the license link, when the source is CC BY-SA. */
function Credit({ source }: { source: Source }) {
  const { name, licensed } = creditFor(source);
  return (
    <>
      <a href={source.url} target="_blank" rel="noopener noreferrer">
        {name}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      {licensed && (
        <>
          {', '}
          <a href={LICENSE_URL} target="_blank" rel="license noopener noreferrer">
            CC BY-SA 4.0
            <span className="sr-only"> license (opens in a new tab)</span>
          </a>
        </>
      )}
    </>
  );
}

/**
 * The reveal keeps the answer and our explanation in front, and the attribution one tap
 * away. The summary line always names where the figure came from (so the credit is
 * visible without opening anything); the panel carries the article links, the
 * CC BY-SA 4.0 license link and any arithmetic. Native <details>: keyboard and screen
 * reader support come with it. Policy: docs/NBA_DATA_RIGHTS.md.
 */
export function SourcesDisclosure({ question: q, extra }: { question: Question; extra: { source: Source } | null }) {
  const names = [...new Set([host(q.source.url), ...(extra ? [host(extra.source.url)] : [])])].join(' and ');
  return (
    <details className="sources">
      <summary>
        <span className="sources-label">Sources &amp; method</span>
        <span className="sources-via">· {names}</span>
      </summary>
      <div className="sources-body">
        <p>
          Answer: <Credit source={q.source} />.
        </p>
        {q.source.derivation && <p>{methodSentence(q.source.derivation)}</p>}
        {extra && (
          <p>
            Bonus fact: <Credit source={extra.source} />.
          </p>
        )}
        <p className="sources-method">
          Each number is checked by hand against the linked page, which states it (or the figures it is worked out from) for the same
          team, season and scope. Facts are
          restated in our own words; text from Wikipedia is by its contributors and used under CC BY-SA 4.0.
        </p>
      </div>
    </details>
  );
}
