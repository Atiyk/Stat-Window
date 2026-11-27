import { forwardRef } from 'react';
import { ordinal, PERCENTILE_PROGRESS_FROM } from '../engine/percentile';
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
 * The slot keeps a fixed minimum height while the answer loads, so nothing below it jumps.
 */
type Props = { comparison: ComparisonApi; isToday: boolean; onPrivacy?: (() => void) | undefined };

export const ComparisonLine = forwardRef<HTMLDivElement, Props>(function ComparisonLine(
  { comparison: c, isToday, onPrivacy },
  ref,
) {
  const s = c.state;
  // Switched off or not eligible: nothing at all, not an empty gap.
  if (s.kind === 'none' || s.kind === 'disabled' || s.kind === 'ineligible') return null;
  const quiet = s.kind === 'consent' || (s.kind === 'gathering' && s.n < PERCENTILE_PROGRESS_FROM);
  return (
    <div className="percentile-slot" ref={ref} tabIndex={-1} aria-live="polite" data-empty={quiet || undefined}>
      {line(c, isToday, onPrivacy)}
    </div>
  );
});

function line(c: ComparisonApi, isToday: boolean, onPrivacy: (() => void) | undefined) {
  const s = c.state;
  const puzzle = isToday ? 'today’s' : 'this puzzle’s';
  switch (s.kind) {
    case 'none':
    case 'disabled':
    case 'ineligible':
      return null;
    case 'loading':
      return <p className="percentile percentile-quiet">Checking {puzzle} games…</p>;
    case 'ready':
      return (
        <p className="percentile">
          <b>{ordinal(s.percentile)} percentile {isToday ? 'today' : 'for this puzzle'}</b>
          <span className="percentile-detail">
            {' '}· based on {s.n.toLocaleString('en-US')} eligible completed {s.n === 1 ? 'game' : 'games'}, as of {time(s.asOf)}.{' '}
            <button type="button" className="btn-link" onClick={c.refresh}>
              Refresh
            </button>
          </span>
        </p>
      );
    case 'gathering':
      // Too few games to say anything useful: no visible line (screen readers still hear the score was counted).
      if (s.n < PERCENTILE_PROGRESS_FROM) return <p className="sr-only">Your score is in {puzzle} tally.</p>;
      return (
        <p className="percentile percentile-quiet">
          Percentiles unlock at {s.threshold.toLocaleString('en-US')} games{isToday ? ' today' : ''}: {s.n.toLocaleString('en-US')} so far.{' '}
          <button type="button" className="btn-link" onClick={c.refresh}>
            Refresh
          </button>
        </p>
      );
    case 'unavailable':
      return <p className="percentile percentile-quiet">Percentile isn’t available right now.</p>;
    case 'off':
      return (
        <p className="percentile percentile-quiet">
          You’re not in {puzzle} comparison.{' '}
          {onPrivacy && (
            <button type="button" className="btn-link" onClick={onPrivacy}>
              Change
            </button>
          )}
        </p>
      );
    case 'consent':
      return null;
  }
}

/**
 * The yes/no, placed under the share buttons so it never pushes them down. Both answers
 * look and weigh the same; nothing is sent until "Count my score".
 */
export function ConsentChoice({ comparison: c, isToday, onPrivacy }: Props) {
  if (c.state.kind !== 'consent') return null;
  return (
    <div className="consent" role="group" aria-labelledby="consent-q">
      <p id="consent-q" className="consent-q">
        See how {isToday ? 'today’s' : 'this'} score compares?
      </p>
      <p className="consent-detail">
        We’d add your total and each question’s points to the puzzle’s tallies, kept with a random code from this browser for 7 days,
        then only as unlinked counts. Your five windows are checked by the server and not kept.{' '}
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
        <button type="button" className="btn btn-quiet btn-small" onClick={c.decline}>
          No thanks
        </button>
      </div>
    </div>
  );
}
