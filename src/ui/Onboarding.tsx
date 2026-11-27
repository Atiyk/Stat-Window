import { useEffect } from 'react';
import { CORE_INTRO } from '../content/teaching';
import { track } from '../lib/track';
import { TeachingPlay } from './TeachingPlay';

/**
 * The core first-play introduction: the easy, real Warriors 73-win question, played
 * untimed with the same Readout, Ruler, scoring, reveal and Live Court Run as the
 * daily. It teaches by play (drag or type, lock, inclusive edges, the narrow-window
 * risk, scoring and court advancement) and can be skipped at once. It never loads or
 * saves a scored slate, and the 24-second shot clock is not mounted until onDone().
 */
export function Onboarding({ onDone, onGuide, playLabel }: {
  onDone: () => void;
  onGuide?: (() => void) | undefined;
  /** What the final button starts, e.g. "Play Game 12". */
  playLabel: string;
}) {
  useEffect(() => track({ name: 'tutorial', step: 'start' }), []);
  const skip = () => { track({ name: 'tutorial', step: 'skip' }); onDone(); };
  const complete = () => { track({ name: 'tutorial', step: 'complete' }); onDone(); };
  return (
    <TeachingPlay
      example={CORE_INTRO}
      className="onboarding-play"
      label="First-play tutorial"
      titleClassName="onboarding-practice-title"
      coach
      courtRun
      status={(phase) => (
        <div className="onboarding-top">
          <p className="context onboarding-status"><span className="onboarding-status__kind">Practice · </span><span className="shot-clock">No timer</span></p>
          {/* First in reading order and on first paint at every size: an experienced player starts at once. */}
          {phase === 'ready' && <button type="button" className="btn-link onboarding-skip" onClick={skip}>Skip tutorial and start</button>}
        </div>
      )}
      actions={({ phase, moved, lock, replay }) => (
        <>
          {phase === 'ready' ? (
            <button type="button" className="btn btn-primary" disabled={!moved} onClick={lock}>
              {moved ? 'Lock the window' : 'Pull the brackets in first'}
            </button>
          ) : phase === 'resolved' ? (
            <button type="button" className="btn btn-primary" onClick={complete}>{playLabel}</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled>Revealing…</button>
          )}
          {phase === 'resolved' && <button type="button" className="btn btn-quiet" onClick={replay}>Try another window</button>}
          {phase === 'resolved' && (
            <p className="onboarding-footnote">
              The real game is five questions, 24 seconds each; the clock starts with the first one.
              {onGuide && <> <button type="button" className="btn-link" onClick={onGuide}>See the three question types</button>.</>}
            </p>
          )}
        </>
      )}
    />
  );
}
