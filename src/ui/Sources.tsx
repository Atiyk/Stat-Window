import type { Question } from '../content/schema';

const CC_BY_SA = / \(CC BY-SA 4\.0\)$/;
const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

type Source = { name: string; url: string };

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/^en\.wikipedia\.org$/, 'Wikipedia');
  } catch {
    return 'source';
  }
}

/** "Wikipedia contributors" with the license link, when the source is CC BY-SA. */
function Credit({ source }: { source: Source }) {
  const licensed = CC_BY_SA.test(source.name);
  return (
    <>
      <a href={source.url} target="_blank" rel="noopener noreferrer">
        {source.name.replace(CC_BY_SA, '')}
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
          Answer: <Credit source={q.source} />
          {q.source.derivation ? <>. Worked out as {q.source.derivation}</> : null}.
        </p>
        {extra && (
          <p>
            Bonus fact: <Credit source={extra.source} />.
          </p>
        )}
        <p className="sources-method">
          Each number is checked by hand against the linked page, which states it for the same team, season and scope. Facts are
          restated in our own words; text from Wikipedia is by its contributors and used under CC BY-SA 4.0.
        </p>
      </div>
    </details>
  );
}
