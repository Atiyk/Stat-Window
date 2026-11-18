import { ordinal } from '../engine/percentile';
import type { ComparisonApi } from './use-comparison';

const time = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
};

/**
 * Today's percentile, right under the score. Says only what the data supports: no number
 * until enough eligible games exist, never "beat X%", and the sample size is always shown.
 */
export function Comparison({ comparison: c, onPrivacy }: { comparison: ComparisonApi; onPrivacy?: (() => void) | undefined }) {
  const s = c.state;
  switch (s.kind) {
    case 'none':
    case 'disabled':
    case 'ineligible':
      return null;
    case 'loading':
      return <p className="percentile percentile-quiet" aria-live="polite">Checking today’s games…</p>;
    case 'ready':
      return (
        <p className="percentile" aria-live="polite">
          <b>{ordinal(s.percentile)} percentile today</b>
          <span className="percentile-detail">
            {' '}· based on {s.n.toLocaleString('en-US')} eligible completed {s.n === 1 ? 'game' : 'games'}, as of {time(s.asOf)}.{' '}
            <button type="button" className="btn-link" onClick={c.refresh}>
              Refresh
            </button>
          </span>
        </p>
      );
    case 'gathering':
      return (
        <p className="percentile percentile-quiet" aria-live="polite">
          Not enough completed games for today’s percentile yet ({s.n.toLocaleString('en-US')} of {s.threshold} needed).{' '}
          <button type="button" className="btn-link" onClick={c.refresh}>
            Refresh
          </button>
        </p>
      );
    case 'unavailable':
      return <p className="percentile percentile-quiet">Today’s percentile isn’t available right now. Your score is saved here.</p>;
    case 'off':
      return (
        <p className="percentile percentile-quiet">
          You’re not in today’s comparison.{' '}
          {onPrivacy && (
            <button type="button" className="btn-link" onClick={onPrivacy}>
              Change
            </button>
          )}
        </p>
      );
    case 'consent':
      return (
        <div className="consent" role="group" aria-labelledby="consent-q">
          <p id="consent-q" className="consent-q">
            See how today’s score compares?
          </p>
          <p className="consent-detail">
            We’d add your total (not your answers) to today’s anonymous tally, kept with a random code for 7 days.{' '}
            {onPrivacy && (
              <button type="button" className="btn-link" onClick={onPrivacy}>
                Details
              </button>
            )}
          </p>
          <div className="consent-actions">
            <button type="button" className="btn btn-quiet btn-small" onClick={c.join}>
              Count my score
            </button>
            <button type="button" className="btn-link" onClick={c.decline}>
              No thanks
            </button>
          </div>
        </div>
      );
  }
}
